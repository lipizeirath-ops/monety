import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';

import {
  doc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp,
  addDoc,
  updateDoc,
  increment
} from 'firebase/firestore';

import { auth, db } from '../firebase/firebase';

interface User {
  id: string;
  email: string;
  balance: number;
  inviteCode: string;
  invitedBy?: string | null;
  totalEarned: number;
  totalWithdrawn: number;
  spinsAvailable: number; // Adicionado para a roleta
  role: string;
  createdAt: any;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, inviteCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateBalance: (amount: number) => Promise<void>;
  completeSpin: (prizeAmount: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/* =========================
   CÓDIGO DE CONVITE
========================= */

const generateInviteCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'MP';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const checkInviteCodeExists = async (code: string): Promise<boolean> => {
  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('inviteCode', '==', code));
  const snapshot = await getDocs(q);
  return !snapshot.empty;
};

const generateUniqueInviteCode = async (): Promise<string> => {
  let code = generateInviteCode();
  let attempts = 0;
  while (await checkInviteCodeExists(code) && attempts < 10) {
    code = generateInviteCode();
    attempts++;
  }
  return code;
};

/* =========================
   PROVIDER
========================= */

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  /* =========================
     LISTENER GLOBAL AUTH
  ========================= */

  useEffect(() => {
    let unsubscribeUser: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (!firebaseUser) {
        setUser(null);
        setToken(null);
        if (unsubscribeUser) unsubscribeUser();
        return;
      }

      try {
        const idToken = await firebaseUser.getIdToken();
        setToken(idToken);
      } catch {
        setToken(null);
      }

      const userDocRef = doc(db, 'users', firebaseUser.uid);

      unsubscribeUser = onSnapshot(userDocRef, (docSnap) => {
        if (!docSnap.exists()) return;
        // Combina os dados e garante valores padrão
        const data = docSnap.data();
        setUser({
          id: firebaseUser.uid,
          email: firebaseUser.email || '',
          balance: data.balance || 0,
          inviteCode: data.inviteCode || '',
          totalEarned: data.totalEarned || 0,
          totalWithdrawn: data.totalWithdrawn || 0,
          spinsAvailable: data.spinsAvailable || 0,
          role: data.role || 'user',
          invitedBy: data.invitedBy || null,
          createdAt: data.createdAt
        } as User);
      });
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUser) unsubscribeUser();
    };
  }, []);

  /* =========================
     FUNÇÕES DE SALDO E ROLETA
  ========================= */

  const updateBalance = async (amount: number) => {
    if (!auth.currentUser) return;
    try {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      await updateDoc(userRef, {
        balance: increment(amount),
        totalEarned: increment(amount)
      });
    } catch (error) {
      console.error("Erro ao atualizar saldo:", error);
      throw error;
    }
  };

  const completeSpin = async (prizeAmount: number) => {
    if (!auth.currentUser) return;
    try {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      await updateDoc(userRef, {
        spinsAvailable: increment(-1), 
        balance: increment(prizeAmount), 
        totalEarned: increment(prizeAmount)
      });
    } catch (error) {
      console.error("Erro ao processar roleta:", error);
      throw error;
    }
  };

  /* =========================
     REGISTER (Corrigido)
  ========================= */

  const register = async (email: string, password: string, inviteCode?: string) => {
    try {
      // 1. CRIAR O UTILIZADOR PRIMEIRO
      // Isto garante que a autenticação é feita antes de fazermos as pesquisas na base de dados
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;
      const idToken = await userCredential.user.getIdToken();
      setToken(idToken);

      let inviterUid: string | null = null;

      // 2. VERIFICAR O CÓDIGO DE CONVITE (AGORA LOGADO COM PERMISSÕES)
      if (inviteCode && inviteCode.trim() !== '') {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('inviteCode', '==', inviteCode.trim().toUpperCase()));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          inviterUid = snapshot.docs[0].id;
        }
      }

      // 3. GERAR O NOVO CÓDIGO (AGORA LOGADO COM PERMISSÕES)
      const newInviteCode = await generateUniqueInviteCode();

      // 4. GUARDAR O DOCUMENTO DO UTILIZADOR
      await setDoc(doc(db, 'users', uid), {
        email,
        balance: 0,
        inviteCode: newInviteCode,
        invitedBy: inviterUid || null,
        totalEarned: 0,
        totalWithdrawn: 0,
        spinsAvailable: 1, // Bônus de 1 giro ao cadastrar
        role: 'user',
        createdAt: serverTimestamp()
      });

      // 5. REGISTAR O CONVITE NA COLEÇÃO INVITES
      if (inviterUid) {
        await addDoc(collection(db, 'invites'), {
          inviterId: inviterUid,
          invitedId: uid,
          level: 1,
          status: 'pending',
          createdAt: serverTimestamp()
        });
      }
    } catch (error: any) {
      console.error("Erro detalhado do Firebase:", error);
      if (error.code === 'auth/email-already-in-use') {
        throw new Error('Este email já está registado.');
      }
      throw new Error('Erro ao criar conta. Tente novamente.');
    }
  };

  /* =========================
     LOGIN & LOGOUT
  ========================= */

  const login = async (email: string, password: string) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await userCredential.user.getIdToken();
      setToken(idToken);
    } catch (error: any) {
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
        throw new Error('Email ou palavra-passe inválidos');
      }
      throw error;
    }
  };

  const logout = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setToken(null);
  };

  const refreshUser = async () => {
    if (!auth.currentUser) return;
    const idToken = await auth.currentUser.getIdToken(true);
    setToken(idToken);
  };

  return (
    <AuthContext.Provider
      value={{ user, token, login, register, logout, refreshUser, updateBalance, completeSpin }}
    >
      {children}
    </AuthContext.Provider>
  );
};

/* =========================
   HOOK
========================= */

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth tem de ser usado dentro do AuthProvider');
  }
  return context;
};
