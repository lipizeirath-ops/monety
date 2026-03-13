// ========================================
// NETLIFY FUNCTION: Criar Pagamento PIX
// ========================================

const { criarPagamentoPIX } = require('./vizzionpay');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey.replace(/\\n/g, '\n')
      })
    });
  }
}

const db = admin.apps.length ? admin.firestore() : null;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-public-key, x-secret-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };

  try {
    if (!db) throw new Error("Conexão com Banco de Dados falhou.");

    const body = JSON.parse(event.body);
    const { amount, userId, userName, userEmail, userDocument, userPhone } = body;

    // LOG: CPF enviado pelo frontend antes do tratamento
    console.log('=== INICIANDO CRIAÇÃO DE PAGAMENTO ===');
    console.log('CPF/CNPJ recebido no backend:', userDocument);

    // 1. Verifica campos obrigatórios
    if (!amount || !userId || !userName || !userDocument) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: 'Campos obrigatórios: amount, userId, userName, userDocument' }) 
      };
    }

    // 2. Limpeza e Validação do Documento (CPF/CNPJ)
    const cleanDocument = userDocument.replace(/\D/g, "");
    
    if (cleanDocument.length !== 11 && cleanDocument.length !== 14) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Documento inválido. O CPF deve ter 11 dígitos ou o CNPJ 14 dígitos.' })
      };
    }

    // 3. Validação de valor mínimo
    if (parseFloat(amount) < 30) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Depósito mínimo é R$ 30,00' }) };
    }

    // 4. Chamada para a API VizzionPay
    const payment = await criarPagamentoPIX({
      amount,
      userId,
      userName,
      userEmail,
      userDocument: cleanDocument, // Enviando o documento limpo
      userPhone 
    });

// 5. Salva no Firestore
    const depositRef = db.collection('deposits').doc();
    
    await depositRef.set({
      userId,
      userName,
      amount: parseFloat(amount),
      // Proteção explícita contra undefined exigida pelo Firestore
      pixCode: payment.pixCode || '',
      qrImage: payment.qrImage || '',
      transactionId: payment.transactionId || '',
      status: 'pending',
      gateway: 'vizzionpay',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Se o pixCode estiver vazio (mesmo com os fallbacks), você pode querer 
    // logar um aviso aqui para investigar depois, mas o Firestore não vai mais quebrar.
    if (!payment.pixCode) {
      console.warn(`[AVISO] Depósito ${depositRef.id} salvo sem pixCode. Verifique o log da VizzionPay.`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        pixCode: payment.pixCode,
        qrImage: payment.qrImage,
        transactionId: payment.transactionId,
        depositId: depositRef.id,
        message: 'PIX gerado com sucesso'
      })
    };

  } catch (error) {
    console.error("Erro na Function create-payment:", error);
    return {
      statusCode: error.status || 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Falha ao processar pagamento',
        details: error.details || {}
      })
    };
  }
};
