from flask import Flask, request, jsonify
import firebase_admin
from firebase_admin import credentials, auth, firestore

app = Flask(__name__)

# --- 1. CONFIGURAÇÃO CRÍTICA DO FIREBASE ADMIN SDK ---
# ATENÇÃO: SUBSTITUA 'caminho/para/sua/serviceAccountKey.json' pelo caminho REAL.
# Este arquivo concede ACESSO TOTAL.
try:
    cred = credentials.Certificate('caminho/para/sua/serviceAccountKey.json')
    firebase_admin.initialize_app(cred)
    db = firestore.client() # Cliente Firestore para operações Admin
    print("Firebase Admin SDK e Firestore inicializados com sucesso.")
except Exception as e:
    print(f"ERRO CRÍTICO ao inicializar o Firebase Admin SDK: {e}")
    # A aplicação não deve rodar sem isso em produção.


# --- 2. FUNÇÃO MIDDLEWARE DE SEGURANÇA (O Muro) ---
# Reutilizamos a função de checagem de Token ID e Role 'admin'
def require_admin_auth(f):
    """
    Decorator (Middleware) para verificar Token ID e Role de 'admin'.
    """
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Authorization header ausente ou mal formatado.'}), 401
        
        id_token = auth_header.split(' ')[1]
        
        try:
            # 1. Verificação do Token Firebase (Genuinidade)
            decoded_token = auth.verify_id_token(id_token)
            uid = decoded_token['uid']
            
            # 2. Autorização (Role Check)
            # Verifica a Custom Claim 'role' (DEVE SER SETADA MANUALMENTE VIA ADMIN SDK)
            if decoded_token.get('role') != 'admin':
                return jsonify({'message': 'Acesso negado. Usuário não é administrador.'}), 403
            
            # Passa o UID do admin para a função da rota
            return f(uid, *args, **kwargs)

        except auth.InvalidIdTokenError:
            return jsonify({'message': 'Token ID inválido ou expirado.'}), 401
        except Exception as e:
            return jsonify({'message': f'Erro de autenticação: {str(e)}'}), 500

    return decorated


# --- 3. DOMÍNIO CRÍTICO: CHECKOUT E TRANSAÇÕES (A ROTA MAIS SENSÍVEL) ---

# POST /api/checkout/confirmar
@app.route('/api/checkout/confirmar', methods=['POST'])
def confirmar_pedido():
    data = request.get_json()
    user_id = data.get('userId')
    itens_pedido = data.get('items')
    valor_enviado = data.get('valorTotal')
    endereco_entrega = data.get('enderecoEntrega')
    metodo_pagamento = data.get('metodoPagamento')

    if not user_id or not itens_pedido:
        return jsonify({'message': 'Dados de usuário ou itens do pedido ausentes.'}), 400

    # 1. VALIDAÇÃO DE PREÇO (Prevenção de Fraude)
    # NUNCA confie no valor_enviado pelo Frontend. Recalcule o total no Backend.
    try:
        produtos_ref = db.collection('produtos')
        
        # Obtém o preço oficial e verifica o estoque para cada item
        estoque_e_precos = {}
        total_calculado_backend = 0.0

        for item in itens_pedido:
            prod_doc = produtos_ref.document(item['id']).get()
            if not prod_doc.exists:
                return jsonify({'message': f"Erro: Produto ID {item['id']} não encontrado."}), 404
            
            prod_data = prod_doc.to_dict()
            
            # Validações Críticas
            if prod_data.get('estoque', 0) < item['quantidade']:
                return jsonify({'message': f"Estoque insuficiente para {prod_data['nome']}."}), 400
            
            # Recálculo: Usa o preço OFICIAL do backend
            preco_oficial = prod_data.get('preco')
            if preco_oficial != item['precoUnitario']:
                print(f"ALERTA DE FRAUDE: Preço de {prod_data['nome']} manipulado. Frontend: {item['precoUnitario']}, Backend: {preco_oficial}")
                # Dependendo da política, você pode parar a transação ou usar o preço oficial
                # Vamos USAR O PREÇO OFICIAL e apenas avisar.
            
            total_calculado_backend += preco_oficial * item['quantidade']
            estoque_e_precos[item['id']] = {'estoque_atual': prod_data['estoque'], 'preco_oficial': preco_oficial}
        
        # Validação Final do Total (Permitimos uma pequena margem de erro por flutuação, mas aqui é rígido)
        if abs(total_calculado_backend - valor_enviado) > 0.01:
             print(f"ALERTA DE FRAUDE: Total enviado ({valor_enviado}) não coincide com o calculado ({total_calculado_backend}).")
             # Retornamos erro para garantir que a transação não ocorra com valores incorretos.
             return jsonify({'message': 'Erro de validação de preço. Valor total incorreto.'}), 400

    except Exception as e:
        print(f"Erro na validação pré-transacional: {e}")
        return jsonify({'message': 'Erro interno na validação dos dados.'}), 500


    # 2. LÓGICA TRANSACIONAL (Transação Atômica de Estoque)
    # Esta é a parte CRÍTICA para evitar condições de corrida (race conditions)
    
    pedido_doc_ref = db.collection('pedidos').document() # Cria a referência antes da transação

    @firestore.transactional
    def executar_transacao(transaction):
        
        # Subtrai o estoque e atualiza os documentos de produtos dentro da transação
        for item in itens_pedido:
            prod_ref = produtos_ref.document(item['id'])
            # 1. Lê o documento DENTRO da transação
            snapshot = prod_ref.get(transaction=transaction) 
            
            # 2. Re-valida o estoque (caso o valor tenha mudado desde a validação inicial)
            estoque_atual = snapshot.get('estoque')
            quantidade_pedida = item['quantidade']
            
            if estoque_atual < quantidade_pedida:
                # Se o estoque mudou e se esgotou, a transação deve falhar e ser abortada.
                raise firestore.Aborted(f"Estoque insuficiente para {snapshot.get('nome')} durante a transação.")

            novo_estoque = estoque_atual - quantidade_pedida
            
            # 3. Escreve a nova quantidade no documento
            transaction.update(prod_ref, {'estoque': novo_estoque})
            
        
        # 4. Cria o pedido na coleção 'pedidos'
        pedido_final = {
            'userId': user_id,
            'itens': [
                {'id': i['id'], 'quantidade': i['quantidade'], 'preco_unitario_oficial': estoque_e_precos[i['id']]['preco_oficial']}
                for i in itens_pedido
            ],
            'valorTotal': total_calculado_backend,
            'status': 'pendente',
            'enderecoEntrega': endereco_entrega,
            'metodoPagamento': metodo_pagamento,
            'timestamp': firestore.SERVER_TIMESTAMP
        }
        transaction.set(pedido_doc_ref, pedido_final)

    # Tenta executar a transação
    try:
        executar_transacao(db.transaction())
        return jsonify({
            'message': 'Pedido processado e estoque atualizado com sucesso.',
            'orderId': pedido_doc_ref.id
        }), 201

    except firestore.Aborted as e:
        # Erro de transação (ex: estoque esgotado durante a tentativa)
        return jsonify({'message': f"Falha na transação: {str(e)}"}), 500
    except Exception as e:
        # Outros erros internos
        return jsonify({'message': f"Erro interno ao finalizar pedido: {str(e)}"}), 500


# --- 4. DOMÍNIO DE GESTÃO: CRUD DE PRODUTOS (ADM) ---

# ROTA SIMPLES DE CHECK ADMIN (POST /api/adm/login_check)
@app.route('/api/adm/login_check', methods=['POST'])
@require_admin_auth
def login_check(uid):
    """ Verifica se o token é válido e o usuário tem permissão 'admin'. """
    return jsonify({
        'message': 'Token Válido e Permissão ADM Confirmada.',
        'uid': uid
    }), 200

# POST /api/adm/produtos/novo
@app.route('/api/adm/produtos/novo', methods=['POST'])
@require_admin_auth
def criar_novo_produto(uid):
    data = request.get_json()

    # 1. Validação de Dados (Simples)
    required_fields = ['nome', 'preco', 'estoque', 'categoria', 'urlImagem']
    if not all(field in data for field in required_fields):
        return jsonify({'message': 'Campos obrigatórios ausentes.'}), 400
    
    # Validação de tipo/valor (Ex: preço e estoque devem ser positivos)
    try:
        preco = float(data['preco'])
        estoque = int(data['estoque'])
        if preco <= 0 or estoque < 0:
            raise ValueError
    except ValueError:
        return jsonify({'message': 'Preço e Estoque devem ser números válidos e positivos.'}), 400

    # 2. Criação do Documento no Firestore usando o Admin SDK
    try:
        novo_produto = {
            'nome': data['nome'],
            'preco': preco,
            'estoque': estoque,
            'categoria': data['categoria'],
            'urlImagem': data['urlImagem'], # Assume que o Frontend ADM já fez o upload para o Storage
            'descricao': data.get('descricao', ''),
            'destaque': data.get('destaque', False),
            'criadoPor': uid,
            'timestamp': firestore.SERVER_TIMESTAMP
        }
        
        doc_ref = db.collection('produtos').add(novo_produto)
        
        return jsonify({
            'message': 'Produto criado com sucesso.',
            'id': doc_ref[1].id
        }), 201
        
    except Exception as e:
        print(f"Erro ao criar produto: {e}")
        return jsonify({'message': f'Erro interno ao salvar produto: {str(e)}'}), 500

# Rotas de ADM adicionais (Ex: PUT /api/adm/produtos/{id}, GET /api/adm/pedidos, etc.)
# ... Devem seguir a mesma estrutura de segurança @require_admin_auth


if __name__ == '__main__':
    # Em um ambiente real (Termux ou Servidor), considere usar Gunicorn ou Waitress.
    # Certifique-se de que a porta 5000 está acessível se você estiver testando de outro dispositivo.
    app.run(debug=True, port=5000, host='0.0.0.0')
