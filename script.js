// --- 1. CONFIGURAÇÃO E VARIÁVEIS GLOBAIS ---

// ATENÇÃO: SUBSTITUA COM SUAS PRÓPRIAS CREDENCIAIS PÚBLICAS DO FIREBASE
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCUlyzjUhQX_6eDaGWv6YnmtdpEROk0Vmw", 
    authDomain: "o-comeco-ee8c7.firebaseapp.com",
    projectId: "o-comeco-ee8c7",
    storageBucket: "o-comeco-ee8c7.firebasestorage.app",
};

// URL da API Python (Domínio Crítico) - Ajuste se seu Termux usar outro endereço/porta
const API_PYTHON_URL = 'http://127.0.0.1:5000/api'; 

// Inicializa o Firebase
const app = firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const auth = firebase.auth();

let currentUser = null; // Armazena o usuário logado

// --- 2. UTILITÁRIOS (Deviam estar em utils.js) ---

function formatarMoeda(valor) {
    return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

// Reutiliza a função de criação de card do index/pesquisa
function criarCardProduto(produto) {
    const card = document.createElement('div');
    card.classList.add('product-card');
    card.setAttribute('data-id', produto.id);

    // Usa 'produto.id' na URL para a página de detalhes
    card.innerHTML = `
        <a href="produto.html?id=${produto.id}">
            <img src="${produto.urlImagem || 'placeholder.png'}" alt="${produto.nome}">
            <h3>${produto.nome}</h3>
        </a>
        <p class="price">${formatarMoeda(produto.preco)}</p>
        <button onclick="adicionarAoCarrinho('${produto.id}', '${produto.nome}', ${produto.preco}, '${produto.urlImagem}')">
            Comprar
        </button>
    `;
    return card;
}


// --- 3. GESTÃO DE ESTADO DO USUÁRIO (Firebase Auth) ---

auth.onAuthStateChanged((user) => {
    currentUser = user;
    const linkLogin = document.getElementById('link-login');
    if (linkLogin) {
        if (user) {
            // Usuário logado
            linkLogin.textContent = `Olá, ${user.email.split('@')[0]} (Sair)`;
            linkLogin.onclick = () => auth.signOut().then(() => {
                alert("Você saiu.");
                window.location.href = 'index.html';
            });
            // Opcional: Atualizar dados de endereço no checkout.html se for o caso
        } else {
            // Usuário deslogado
            linkLogin.textContent = 'Login/Cadastro';
            linkLogin.onclick = () => window.location.href = 'login.html'; 
        }
    }
    // Sempre atualiza o contador do carrinho
    atualizarContadorCarrinho(); 
});


// --- 4. FUNÇÕES DE AUTENTICAÇÃO (Para login.html) ---

function mostrarMensagem(message, isError = false) {
    const msgElement = document.getElementById('auth-message');
    if (msgElement) {
        msgElement.textContent = message;
        msgElement.style.color = isError ? 'red' : 'green';
    }
}

async function realizarRegistro() {
    const email = document.getElementById('register-email').value;
    const senha = document.getElementById('register-senha').value;
    const confirmSenha = document.getElementById('register-confirm-senha').value;

    if (senha !== confirmSenha) {
        mostrarMensagem("As senhas não coincidem.", true);
        return;
    }

    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, senha);
        const user = userCredential.user;
        
        // OPCIONAL: Criar um documento inicial na coleção 'usuarios' do Firestore
        await db.collection('usuarios').doc(user.uid).set({
            email: user.email,
            role: 'cliente', // Importante para as regras de segurança
            dataRegistro: firebase.firestore.FieldValue.serverTimestamp()
        });

        mostrarMensagem("Cadastro realizado com sucesso! Redirecionando...", false);
        setTimeout(() => { window.location.href = 'index.html'; }, 1500);

    } catch (error) {
        console.error("Erro no registro:", error);
        mostrarMensagem(`Erro no cadastro: ${error.message}`, true);
    }
}

async function realizarLogin() {
    const email = document.getElementById('login-email').value;
    const senha = document.getElementById('login-senha').value;

    try {
        await auth.signInWithEmailAndPassword(email, senha);
        mostrarMensagem("Login realizado com sucesso! Redirecionando...", false);
        setTimeout(() => { window.location.href = 'index.html'; }, 1500);
    } catch (error) {
        console.error("Erro no login:", error);
        mostrarMensagem("Login falhou. Verifique e-mail e senha.", true);
    }
}


// --- 5. LÓGICA DO CARRINHO (Compartilhada) ---

let carrinho = JSON.parse(localStorage.getItem('carrinho')) || [];

function atualizarContadorCarrinho() {
    const totalItens = carrinho.reduce((sum, item) => sum + item.quantidade, 0);
    const linkCarrinho = document.getElementById('link-carrinho');
    if (linkCarrinho) {
        linkCarrinho.textContent = `Carrinho (${totalItens})`;
    }
    localStorage.setItem('carrinho', JSON.stringify(carrinho));
}

function adicionarAoCarrinho(id, nome, preco, urlImagem) {
    const itemExistente = carrinho.find(item => item.id === id);
    if (itemExistente) {
        itemExistente.quantidade += 1;
    } else {
        carrinho.push({ id, nome, preco, urlImagem, quantidade: 1 });
    }
    atualizarContadorCarrinho();
    alert(`${nome} adicionado ao carrinho!`);
}

function calcularTotalCarrinho() {
    return carrinho.reduce((total, item) => total + (item.preco * item.quantidade), 0);
}

// Lógica de Renderização para carrinho.html
async function carregarItensCarrinho() {
    const container = document.getElementById('cart-items-container');
    const subtotalSpan = document.getElementById('cart-subtotal');
    const totalSpan = document.getElementById('cart-total');
    const btnCheckout = document.getElementById('btn-checkout');
    
    if (!container || !subtotalSpan || !totalSpan) return;

    if (carrinho.length === 0) {
        container.innerHTML = '<p>Seu carrinho está vazio.</p>';
        btnCheckout.disabled = true;
        subtotalSpan.textContent = formatarMoeda(0);
        totalSpan.textContent = formatarMoeda(0);
        return;
    }
    
    container.innerHTML = '';
    carrinho.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('cart-item');
        itemDiv.innerHTML = `
            <img src="${item.urlImagem || 'placeholder.png'}" alt="${item.nome}">
            <div class="item-details">
                <h4>${item.nome}</h4>
                <p>Preço unitário: ${formatarMoeda(item.preco)}</p>
            </div>
            <div class="item-controls">
                <button onclick="mudarQuantidade('${item.id}', -1)">-</button>
                <input type="number" value="${item.quantidade}" min="1" onchange="atualizarQuantidadeManual('${item.id}', this.value)">
                <button onclick="mudarQuantidade('${item.id}', 1)">+</button>
            </div>
            <span class="item-price">${formatarMoeda(item.preco * item.quantidade)}</span>
            <button onclick="removerItem('${item.id}')" style="margin-left: 15px;">X</button>
        `;
        container.appendChild(itemDiv);
    });

    const subtotal = calcularTotalCarrinho();
    subtotalSpan.textContent = formatarMoeda(subtotal);
    totalSpan.textContent = formatarMoeda(subtotal); // Sem frete por enquanto
    btnCheckout.disabled = false;
}

function mudarQuantidade(id, delta) {
    const item = carrinho.find(i => i.id === id);
    if (item) {
        item.quantidade += delta;
        if (item.quantidade <= 0) {
            removerItem(id);
        } else {
            carregarItensCarrinho(); // Recarrega para atualizar a tela
        }
    }
    atualizarContadorCarrinho();
}

function atualizarQuantidadeManual(id, novaQtd) {
    const item = carrinho.find(i => i.id === id);
    const qtd = parseInt(novaQtd);
    if (item && qtd >= 1) {
        item.quantidade = qtd;
    } else if (item && qtd < 1) {
        removerItem(id);
    }
    carregarItensCarrinho();
    atualizarContadorCarrinho();
}

function removerItem(id) {
    carrinho = carrinho.filter(item => item.id !== id);
    carregarItensCarrinho();
    atualizarContadorCarrinho();
}

function irParaCheckout() {
    if (carrinho.length > 0) {
        // Redireciona para a página de checkout
        window.location.href = 'checkout.html';
    } else {
        alert("Seu carrinho está vazio.");
    }
}


// --- 6. LÓGICA DE DETALHES DO PRODUTO (Para produto.html) ---

async function carregarDetalhesProduto() {
    const params = new URLSearchParams(window.location.search);
    const produtoId = params.get('id');
    const container = document.getElementById('product-detail-container');
    const title = document.getElementById('product-title');
    const messageArea = document.getElementById('loading-error-message');

    if (!produtoId) {
        container.innerHTML = '<h1>Produto Não Encontrado</h1><p>ID do produto ausente na URL.</p>';
        return;
    }
    
    try {
        // Consulta o Firestore pelo ID
        const doc = await db.collection('produtos').doc(produtoId).get();
        
        if (!doc.exists) {
            container.innerHTML = '<h1>Produto Não Encontrado</h1><p>O produto que você está buscando não existe mais.</p>';
            return;
        }

        const produto = { id: doc.id, ...doc.data() };
        
        // Renderiza os detalhes
        title.textContent = `${produto.nome} | O Começo`;
        container.innerHTML = `
            <div class="product-image-area">
                <img src="${produto.urlImagem || 'placeholder.png'}" alt="${produto.nome}">
            </div>
            <div class="product-info-area">
                <h1>${produto.nome}</h1>
                <p class="detail-description">${produto.descricao || 'Nenhuma descrição fornecida.'}</p>
                <p>Estoque: <strong>${produto.estoque > 0 ? produto.estoque : 'Esgotado'}</strong></p>
                
                <p class="detail-price">${formatarMoeda(produto.preco)}</p>
                
                <div class="detail-controls">
                    <button ${produto.estoque <= 0 ? 'disabled' : ''} onclick="adicionarAoCarrinho('${produto.id}', '${produto.nome}', ${produto.preco}, '${produto.urlImagem}')">
                        Adicionar ao Carrinho
                    </button>
                </div>
            </div>
        `;
    } catch (error) {
        console.error("Erro ao carregar detalhes:", error);
        messageArea.textContent = 'Houve um erro ao buscar os detalhes do produto.';
    }
}


// --- 7. LÓGICA DE CHECKOUT (Para checkout.html) ---

// Função para inicializar o checkout
function inicializarCheckout() {
    const checkoutContent = document.getElementById('checkout-content');
    const loginRequired = document.getElementById('login-required-message');

    if (!currentUser) {
        // Exibe mensagem de login obrigatório
        if (checkoutContent) checkoutContent.style.display = 'none';
        if (loginRequired) loginRequired.style.display = 'block';
        return;
    }
    
    // O usuário está logado, carrega o resumo
    if (checkoutContent) checkoutContent.style.display = 'block';
    if (loginRequired) loginRequired.style.display = 'none';
    
    carregarResumoCheckout();
}

function carregarResumoCheckout() {
    const itemsDiv = document.getElementById('checkout-items');
    const totalSpan = document.getElementById('checkout-total');
    
    if (!itemsDiv || !totalSpan) return;

    if (carrinho.length === 0) {
        itemsDiv.innerHTML = '<p style="color:red;">Seu carrinho está vazio. <a href="index.html">Voltar à loja.</a></p>';
        document.getElementById('btn-finalizar-pedido').disabled = true;
        totalSpan.textContent = formatarMoeda(0);
        return;
    }

    itemsDiv.innerHTML = '';
    carrinho.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('order-item-checkout');
        itemDiv.innerHTML = `
            <span>${item.nome} (x${item.quantidade})</span>
            <span>${formatarMoeda(item.preco * item.quantidade)}</span>
        `;
        itemsDiv.appendChild(itemDiv);
    });

    const total = calcularTotalCarrinho();
    totalSpan.textContent = formatarMoeda(total);
}

async function finalizarPedido() {
    if (!currentUser) {
        alert("Você precisa estar logado para finalizar o pedido.");
        window.location.href = 'login.html';
        return;
    }

    const cep = document.getElementById('cep').value;
    const endereco = document.getElementById('endereco').value;
    // ... validação de outros campos ...

    if (!carrinho || carrinho.length === 0) {
        alert("O carrinho está vazio.");
        return;
    }
    
    const statusMessage = document.getElementById('checkout-status-message');
    const btnFinalizar = document.getElementById('btn-finalizar-pedido');
    btnFinalizar.disabled = true;
    statusMessage.textContent = "Processando pedido... Aguarde.";
    
    // Prepara os dados para o Python (Domínio Crítico)
    const pedidoData = {
        userId: currentUser.uid,
        items: carrinho.map(item => ({
            id: item.id,
            precoUnitario: item.preco,
            quantidade: item.quantidade
        })),
        valorTotal: calcularTotalCarrinho(), // O Python DEVE recalcular e validar isso!
        enderecoEntrega: { cep, endereco },
        metodoPagamento: document.getElementById('payment-method').value
    };

    try {
        // Chamada Segura para a API Python (POST /api/checkout/confirmar)
        const response = await fetch(`${API_PYTHON_URL}/checkout/confirmar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Opcional: Enviar token de Auth se o Python precisar (boa prática)
                'Authorization': `Bearer ${await currentUser.getIdToken()}` 
            },
            body: JSON.stringify(pedidoData)
        });

        const data = await response.json();

        if (response.ok) {
            // Sucesso! O Python validou o estoque, preço e criou o pedido no Firestore.
            localStorage.removeItem('carrinho'); // Limpa o carrinho
            atualizarContadorCarrinho();
            statusMessage.textContent = `Pedido #${data.orderId} confirmado! Redirecionando para o painel de pedidos.`;
            statusMessage.style.color = 'green';
            
            // Simula o redirecionamento
            setTimeout(() => { window.location.href = 'index.html'; }, 3000); 

        } else {
            // Falha (Ex: Estoque insuficiente, erro de preço, erro no Python)
            statusMessage.textContent = `Erro: ${data.message || 'Falha ao processar o pedido.'}`;
            statusMessage.style.color = 'red';
            btnFinalizar.disabled = false;
        }

    } catch (error) {
        console.error("Erro na comunicação com a API Python:", error);
        statusMessage.textContent = 'Erro de conexão. Tente novamente.';
        statusMessage.style.color = 'red';
        btnFinalizar.disabled = false;
    }
}


// --- 8. INICIALIZAÇÃO DE PÁGINAS ---

// Esta função garante que as funções específicas de cada página sejam chamadas.
document.addEventListener('DOMContentLoaded', () => {
    // Verifica qual página estamos e chama a função de inicialização correspondente
    const path = window.location.pathname;
    
    if (path.includes('carrinho.html')) {
        carregarItensCarrinho();
    } else if (path.includes('produto.html')) {
        carregarDetalhesProduto();
    } else if (path.includes('checkout.html')) {
        inicializarCheckout();
    } else if (path.includes('index.html') || path === '/' || path === '/index.html') {
        // Função de index (carregamento de destaques)
        // Isso deve ser chamado pelo index.html, mas incluímos a função aqui:
        // carregarDestaques(); 
    }
});
