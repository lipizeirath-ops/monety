// ========================================
// BIBLIOTECA VIZZIONPAY - API CLIENT CORRIGIDA
// ========================================
const axios = require('axios');

const VIZZION_BASE_URL = process.env.VIZZION_BASE_URL || 'https://api.vizzionpay.com/api/v1';
const SITE_URL = process.env.URL;

const apiClient = axios.create({
  baseURL: VIZZION_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

/**
 * Valida e configura os headers de autenticação customizados
 */
function configurarAutenticacao() {
  const publicKey = process.env.VIZZION_PUBLIC_KEY;
  const secretKey = process.env.VIZZION_SECRET_KEY;

  if (!publicKey || !secretKey) {
    throw new Error('Credenciais VizzionPay (PUBLIC_KEY ou SECRET_KEY) não configuradas no Netlify.');
  }

  // Injeta os headers específicos exigidos pelo Gateway
  apiClient.defaults.headers.common['x-public-key'] = publicKey;
  apiClient.defaults.headers.common['x-secret-key'] = secretKey;
}

async function criarPagamentoPIX(data) {
  configurarAutenticacao();
  
  const { amount, userId, userName, userEmail, userDocument, userPhone } = data;
  const callbackUrl = `${SITE_URL}/.netlify/functions/webhook-payment`;

  // Limpeza de dados com replace(/\D/g, '') para enviar apenas números
  const cleanDocument = (userDocument || '02499967315').replace(/\D/g, '');
  const cleanPhone = (userPhone || '11999999999').replace(/\D/g, '');
  
  // Define dinamicamente o tipo de documento
  const documentType = cleanDocument.length === 14 ? 'CNPJ' : 'CPF';

  const payload = {
    identifier: `dep_${userId}_${Date.now()}`,
    amount: parseFloat(amount),
    client: {
      name: userName,
      document: cleanDocument,
      documentType: documentType, // <- CAMPO ADICIONADO PARA VALIDAÇÃO DA API
      email: (userEmail && userEmail.includes('@')) ? userEmail : 'contato@seudominio.com',
      phone: cleanPhone
    },
    callbackUrl: callbackUrl
  };

  // LOG: Payload completo enviado para a API
  console.log('=== PAYLOAD ENVIADO PARA VIZZIONPAY ===');
  console.log(JSON.stringify(payload, null, 2));

try {
    // Confirmando o uso do endpoint /gateway/pix/receive
    const response = await apiClient.post('/gateway/pix/receive', payload);
    const paymentData = response.data;

    // LOG: Resposta completa da VizzionPay para debug
    console.log('=== RESPOSTA DA API VIZZIONPAY ===');
    console.log(JSON.stringify(paymentData, null, 2));

    // Muitas APIs envelopam a resposta dentro de um objeto "data" ou "pix"
    // Aqui criamos uma camada de segurança extraindo os dados de onde eles estiverem
    const targetData = paymentData.data || paymentData.pix || paymentData;

    // Busca ampliada pelos campos retornados + Fallback final para evitar undefined
    const pixCode = targetData.pixCode || targetData.emv || targetData.payload || targetData.copyAndPaste || targetData.qrCode || '';
    const qrImage = targetData.qrImage || targetData.qrcodeImage || targetData.base64 || targetData.qrCodeBase64 || '';
    const transactionId = targetData.id || targetData.transactionId || targetData.identifier || '';

    return {
      success: true,
      pixCode: pixCode,
      qrImage: qrImage,
      transactionId: String(transactionId)
    };
  } catch (error) {
    console.error('--- ERRO API VIZZION PAY ---');
    const errorData = error.response?.data;
    console.error('Detalhes do Erro da VizzionPay:', JSON.stringify(errorData, null, 2));
    
    throw {
      status: error.response?.status || 500,
      message: errorData?.message || 'Erro ao processar pagamento na VizzionPay',
      details: errorData || error.message
    };
  }
}

async function verificarStatusPagamento(transactionId) {
  configurarAutenticacao();
  try {
    const response = await apiClient.get(`/gateway/transactions?id=${transactionId}`);
    return response.data;
  } catch (error) {
    throw error.response?.data || new Error('Falha ao verificar status');
  }
}

async function criarSaquePIX(data) {
  // ... (mantido igual)
  configurarAutenticacao();
  const { amount, pixKey, pixType, withdrawId, ownerName, ownerDocument, ownerPhone } = data;
  
  const payload = {
    identifier: String(withdrawId),
    amount: parseFloat(amount),
    discountFeeOfReceiver: false,
    pix: { key: pixKey, type: pixType },
    owner: {
      name: ownerName || 'Nome Nao Informado',
      document: (ownerDocument || '62846175084').replace(/\D/g, ''),
      phone: (ownerPhone || '11999999999').replace(/\D/g, '')
    },
    callbackUrl: `${SITE_URL}/.netlify/functions/webhook-transfer`
  };

  try {
    const response = await apiClient.post('/gateway/transfers', payload);
    return {
      success: true,
      transactionId: response.data.id || response.data.transactionId,
      status: response.data.status
    };
  } catch (error) {
    console.error('--- ERRO SAQUE VIZZION ---', error.response?.data);
    throw error.response?.data || new Error('Falha ao processar saque');
  }
}

module.exports = {
  criarPagamentoPIX,
  verificarStatusPagamento,
  criarSaquePIX
};
