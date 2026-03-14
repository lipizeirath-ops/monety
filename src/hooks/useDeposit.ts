import { useState } from 'react';
import { useAuth } from './useAuth';

export function useDeposit() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [pixCode, setPixCode] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);

  const initiateDeposit = async (amount: number): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Usuário não autenticado' };

    setLoading(true);
    setPixCode(null);
    setQrImage(null);

    try {
      // Chamar Netlify Function para criar pagamento VizzionPay
      const response = await fetch('/.netlify/functions/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amount,
          userId: user.id,
          userName: user.email?.split('@')[0] || 'Usuário'
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao gerar PIX');
      }

      if (!data.success || !data.pixCode) {
        throw new Error('Código PIX não retornado');
      }

      setPixCode(data.pixCode);
      setQrImage(data.qrImage);

      return { success: true };
    } catch (error: any) {
      console.error('Erro ao iniciar depósito:', error);
      return { success: false, error: error.message || 'Erro desconhecido' };
    } finally {
      setLoading(false);
    }
  };

  const resetDeposit = () => {
    setPixCode(null);
    setQrImage(null);
  };

  return {
    loading,
    pixCode,
    qrImage,
    initiateDeposit,
    resetDeposit
  };
}
