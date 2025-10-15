// Acessa a instância do Firestore (db) e as funções de carrinho do script.js
// Assume que 'db' e 'adicionarAoCarrinho' já estão definidos em script.js

const db = firebase.firestore();
const resultadosDiv = document.getElementById('search-results');

// Variáveis de estado globais para a busca atual
let termoBusca = '';
let filtrosAtuais = {};

// --- 1. FUNÇÃO DE OBTENÇÃO DO TERMO DA URL ---
function obterParametroBusca() {
    const params = new URLSearchParams(window.location.search);
    const termo = params.get('q') || '';
    
    // Atualiza a barra de busca para refletir o termo
    const inputBusca = document.getElementById('input-busca');
    if (inputBusca) {
        inputBusca.value = termo;
    }
    
    termoBusca = termo;
}

// --- 2. FUNÇÃO PRINCIPAL: REALIZA A CONSULTA AO FIRESTORE ---
async function executarBusca() {
    resultadosDiv.innerHTML = '<p>Buscando produtos...</p>';
    
    // **NOTA DE SEGURANÇA/OTIMIZAÇÃO:** // O Firestore não suporta busca 'full-text' como um DB tradicional.
    // A busca por nome deve ser um 'startsWith' (busca de prefixo) e requer 
    // um índice composto no Firebase para funcionar com filtros.

    try {
        let query = db.collection('produtos');

        // Adicionar filtros de preço e categoria
        const { minPrice, maxPrice, category } = filtrosAtuais;

        if (minPrice > 0) {
            query = query.where('preco', '>=', minPrice);
        }
        if (maxPrice > 0 && maxPrice >= minPrice) {
            query = query.where('preco', '<=', maxPrice);
        }
        if (category && category !== "") {
            query = query.where('categoria', '==', category);
        }
        
        // **Filtro de Texto:** Tenta usar o nome do produto como filtro inicial.
        // Isso só funciona para correspondências exatas ou consultas de prefixo.
        // Se termoBusca for usado, a query só funcionará se um índice específico for criado
        // e se não conflitar com as cláusulas 'where' de preço e categoria.
        // Para uma busca realmente robusta, integrações com Algolia ou Firebase Extensions são recomendadas.
        if (termoBusca) {
            // Simplificando para a consulta inicial: busca a categoria exata OU o nome que comece com o termo.
            // Para evitar complexidade de índices compostos iniciais, focaremos nos filtros
            // e faremos uma filtragem básica de nome (que requer apenas um índice simples).
            query = query.where('nome', '>=', termoBusca).where('nome', '<=', termoBusca + '\uf8ff');
        }

        // Ordenação e Limite (para performance)
        query = query.orderBy('preco', 'asc').limit(50); 
        
        const snapshot = await query.get();

        if (snapshot.empty) {
            resultadosDiv.innerHTML = `<p>Nenhum resultado encontrado para "${termoBusca}".</p>`;
            return;
        }

        // Limpa e renderiza
        resultadosDiv.innerHTML = '';
        snapshot.forEach(doc => {
            const produto = { id: doc.id, ...doc.data() };
            // Reutiliza a função de criação de card do script.js
            resultadosDiv.appendChild(criarCardProduto(produto)); 
        });

    } catch (error) {
        console.error("Erro na busca do Firestore. Verifique os índices de segurança:", error);
        resultadosDiv.innerHTML = '<p style="color: red;">Erro ao executar a busca. Verifique o console para detalhes da falha de índice.</p>';
    }
}

// --- 3. FUNÇÃO DE APLICAÇÃO DE FILTROS ---
function aplicarFiltros() {
    // 1. Coleta os valores dos filtros da barra lateral
    const min = parseFloat(document.getElementById('min-price').value) || 0;
    const max = parseFloat(document.getElementById('max-price').value) || 0;
    const cat = document.getElementById('category').value;
    
    // 2. Atualiza o estado global de filtros
    filtrosAtuais = {
        minPrice: min,
        maxPrice: max,
        category: cat
    };
    
    // 3. Reexecuta a busca com os novos filtros
    executarBusca();
}


// --- 4. INICIALIZAÇÃO DA PÁGINA ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Obtém o termo da URL
    obterParametroBusca();
    
    // 2. Executa a primeira busca
    aplicarFiltros(); 
});

// A função 'criarCardProduto' e 'adicionarAoCarrinho' devem ser globais no script.js
// para que o pesquisa.js possa chamá-las (ou devem ser importadas se usar módulos JS).
