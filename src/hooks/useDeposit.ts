import React, { useState } from 'react';
import { useDeposit } from './useDeposit'; // Ajuste o caminho do import conforme necessário

export default function DepositScreen() {
  const { loading, pixCode, qrImage, initiateDeposit } = useDeposit();
  const [amount, setAmount] = useState<number | ''>('');

  const handleGeneratePix = async () => {
    if (!amount || Number(amount) < 30) {
      alert('Por favor, insira um valor válido (Mínimo R$ 30,00).');
      return;
    }
    
    const { success, error } = await initiateDeposit(Number(amount));
    
    if (!success) {
      alert(`Erro: ${error}`);
    }
  };

  const handleCopyPix = () => {
    if (pixCode) {
      navigator.clipboard.writeText(pixCode);
      alert('Código PIX copiado!');
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '0 auto', textAlign: 'center', padding: '20px' }}>
      <h2>Depositar via PIX</h2>

      {/* Formulário de Depósito (Aparece apenas se o PIX ainda não foi gerado) */}
      {!pixCode && (
        <div style={{ marginBottom: '20px' }}>
          <input
            type="number"
            placeholder="Valor do depósito (Ex: 50.00)"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            style={{ padding: '10px', width: '100%', marginBottom: '10px' }}
          />
          <button 
            onClick={handleGeneratePix} 
            disabled={loading}
            style={{ padding: '10px 20px', cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? 'Gerando PIX...' : 'Gerar PIX'}
          </button>
        </div>
      )}

      {/* Área do PIX Gerado */}
      {(pixCode || qrImage) && (
        <div style={{ border: '1px solid #ccc', padding: '20px', borderRadius: '8px', marginTop: '20px' }}>
          
          {/* 1. Valor do depósito */}
          <h3>Valor do depósito: R$ {Number(amount).toFixed(2).replace('.', ',')}</h3>

          {/* 2. QR Code PIX (Aparece somente se qrImage existir) */}
          {qrImage && (
            <div style={{ margin: '20px 0' }}>
              <img
                src={qrImage}
                alt="QR Code PIX"
                style={{ width: 250, height: 250 }}
              />
            </div>
          )}

          {/* 3. Código PIX copia e cola */}
          {pixCode && (
            <div style={{ marginBottom: '20px' }}>
              <p style={{ fontWeight: 'bold', marginBottom: '5px' }}>Código Copia e Cola:</p>
              <textarea
                readOnly
                value={pixCode}
                style={{ width: '100%', height: '80px', padding: '10px', resize: 'none', marginBottom: '10px' }}
              />
              <button onClick={handleCopyPix} style={{ padding: '8px 16px', cursor: 'pointer' }}>
                Copiar Código
              </button>
            </div>
          )}

          {/* 4. Mensagem de aguardando */}
          <div style={{ marginTop: '20px', color: '#666', fontWeight: 'bold' }}>
            ⏳ Aguardando pagamento...
          </div>
          
        </div>
      )}
    </div>
  );
}
