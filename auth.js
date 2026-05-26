'use strict';

/* =============================================================================
  auth.js — Login Google Musicala
  -----------------------------------------------------------------------------
  Bloquea la carga visual del panel hasta que exista una sesión Google válida
  y el correo pertenezca a la lista blanca definida abajo.
============================================================================= */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyA12_rlUjYM2z4aFG4bf43Wf0tSNTxC0Vg',
  authDomain: 'estudiantes-musicala.firebaseapp.com',
  projectId: 'estudiantes-musicala',
  storageBucket: 'estudiantes-musicala.firebasestorage.app',
  messagingSenderId: '342934326940',
  appId: '1:342934326940:web:a75cc4634569c5a4a82759'
};

const ALLOWED_EMAILS = [
  'alekcaballeromusic@gmail.com',
  'catalina.medina.leal@gmail.com',
  'imusicala@gmail.com',
  'musicalaasesor@gmail.com'
];

const allowedEmailSet = new Set(ALLOWED_EMAILS.map(normalizeEmail));

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

let currentAuthorizedUser = null;
let authInitialized = false;

window.MusicalaAuth = {
  allowedEmails: ALLOWED_EMAILS.slice(),
  isEmailAllowed,
  isAuthorized: () => Boolean(currentAuthorizedUser && isEmailAllowed(currentAuthorizedUser.email)),
  getCurrentUser: () => currentAuthorizedUser,
  signOut: logout
};

document.addEventListener('DOMContentLoaded', () => {
  bindAuthUI();
});

bootstrapAuth();

async function bootstrapAuth() {
  try {
    await setPersistence(auth, browserLocalPersistence);

    try {
      await getRedirectResult(auth);
    } catch (redirectError) {
      console.warn('No se pudo completar el login por redirección:', redirectError);
      showAuthError(getReadableAuthError(redirectError));
    }

    onAuthStateChanged(auth, async (user) => {
      authInitialized = true;

      if (!user) {
        currentAuthorizedUser = null;
        renderSignedOut();
        dispatchAuthEvent('musicala:auth-signedout');
        dispatchAuthEvent('musicala:auth-ready');
        return;
      }

      if (!isEmailAllowed(user.email)) {
        const deniedEmail = user.email || 'correo no identificado';
        currentAuthorizedUser = null;
        renderDenied(deniedEmail);
        dispatchAuthEvent('musicala:auth-denied', { email: deniedEmail });
        dispatchAuthEvent('musicala:auth-ready');

        try {
          await signOut(auth);
        } catch (error) {
          console.warn('No se pudo cerrar la sesión no autorizada:', error);
        }
        return;
      }

      currentAuthorizedUser = user;
      renderAuthorized(user);
      dispatchAuthEvent('musicala:auth-authorized', {
        user: serializeUser(user)
      });
      dispatchAuthEvent('musicala:auth-ready');
    });
  } catch (error) {
    console.error('Error inicializando Firebase Auth:', error);
    authInitialized = true;
    currentAuthorizedUser = null;
    renderAuthError('No se pudo inicializar el login. Revisa Firebase Auth y la conexión.');
    dispatchAuthEvent('musicala:auth-error', { message: error?.message || String(error) });
    dispatchAuthEvent('musicala:auth-ready');
  }
}

function bindAuthUI() {
  const loginButton = document.getElementById('btnLoginGoogle');
  const logoutButton = document.getElementById('btnLogout');

  if (loginButton) {
    loginButton.addEventListener('click', async () => {
      await loginWithGoogle();
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      await logout();
    });
  }
}

async function loginWithGoogle() {
  clearAuthError();
  setLoginButtonLoading(true);

  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.warn('Login con popup falló:', error);

    if (shouldUseRedirectFallback(error)) {
      try {
        await signInWithRedirect(auth, provider);
        return;
      } catch (redirectError) {
        console.error('Login por redirección falló:', redirectError);
        showAuthError(getReadableAuthError(redirectError));
      }
    } else {
      showAuthError(getReadableAuthError(error));
    }
  } finally {
    setLoginButtonLoading(false);
  }
}

async function logout() {
  clearAuthError();

  try {
    await signOut(auth);
  } catch (error) {
    console.error('Error cerrando sesión:', error);
    showAuthError('No se pudo cerrar sesión. Intenta nuevamente.');
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isEmailAllowed(email) {
  return allowedEmailSet.has(normalizeEmail(email));
}

function serializeUser(user) {
  return {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
    photoURL: user.photoURL || ''
  };
}

function renderAuthPending() {
  document.body.classList.add('auth-pending');
  document.body.classList.remove('auth-authorized', 'auth-denied', 'auth-error');
  setLoginButtonLoading(false);
  clearAuthError();
}

function renderSignedOut() {
  document.body.classList.remove('auth-pending', 'auth-authorized', 'auth-denied', 'auth-error');
  document.body.classList.add('auth-signed-out');
  clearUserBox();

  if (authInitialized) {
    showAuthMessage('Inicia sesión con una cuenta autorizada para ver el panel.');
  }
}

function renderAuthorized(user) {
  document.body.classList.remove('auth-pending', 'auth-signed-out', 'auth-denied', 'auth-error');
  document.body.classList.add('auth-authorized');
  clearAuthError();
  setUserBox(user);
}

function renderDenied(email) {
  document.body.classList.remove('auth-pending', 'auth-authorized', 'auth-error');
  document.body.classList.add('auth-denied', 'auth-signed-out');
  clearUserBox();
  showAuthError(`El correo ${email} no está autorizado para ver este panel.`);
}

function renderAuthError(message) {
  document.body.classList.remove('auth-pending', 'auth-authorized', 'auth-denied');
  document.body.classList.add('auth-error', 'auth-signed-out');
  clearUserBox();
  showAuthError(message);
}

function setUserBox(user) {
  const box = document.getElementById('authUserBox');
  const emailNode = document.getElementById('authUserEmail');

  if (emailNode) emailNode.textContent = user?.email || 'Sesión autorizada';
  if (box) box.hidden = false;
}

function clearUserBox() {
  const box = document.getElementById('authUserBox');
  const emailNode = document.getElementById('authUserEmail');

  if (emailNode) emailNode.textContent = '—';
  if (box) box.hidden = true;
}

function setLoginButtonLoading(isLoading) {
  const loginButton = document.getElementById('btnLoginGoogle');
  if (!loginButton) return;

  loginButton.disabled = Boolean(isLoading);
  loginButton.dataset.loading = isLoading ? 'true' : 'false';
  loginButton.innerHTML = isLoading
    ? '<span class="btn-google__icon" aria-hidden="true">…</span> Verificando cuenta'
    : '<span class="btn-google__icon" aria-hidden="true">G</span> Iniciar sesión con Google';
}

function showAuthMessage(message) {
  const errorNode = document.getElementById('authError');
  if (!errorNode) return;

  errorNode.hidden = false;
  errorNode.classList.remove('auth-error--danger');
  errorNode.textContent = message;
}

function showAuthError(message) {
  const errorNode = document.getElementById('authError');
  if (!errorNode) return;

  errorNode.hidden = false;
  errorNode.classList.add('auth-error--danger');
  errorNode.textContent = message;
}

function clearAuthError() {
  const errorNode = document.getElementById('authError');
  if (!errorNode) return;

  errorNode.hidden = true;
  errorNode.classList.remove('auth-error--danger');
  errorNode.textContent = '';
}

function shouldUseRedirectFallback(error) {
  const code = String(error?.code || '');
  return code.includes('popup-blocked') || code.includes('operation-not-supported-in-this-environment');
}

function getReadableAuthError(error) {
  const code = String(error?.code || '');

  if (code.includes('popup-closed-by-user')) {
    return 'Se cerró la ventana de Google antes de terminar el inicio de sesión.';
  }

  if (code.includes('popup-blocked')) {
    return 'El navegador bloqueó la ventana de Google. Permite pop-ups o intenta de nuevo.';
  }

  if (code.includes('unauthorized-domain')) {
    return 'Este dominio no está autorizado en Firebase Authentication. Agrégalo en Firebase Console > Authentication > Settings > Authorized domains.';
  }

  if (code.includes('operation-not-allowed')) {
    return 'El proveedor Google no está habilitado en Firebase Authentication.';
  }

  return error?.message || 'No se pudo iniciar sesión con Google.';
}

function dispatchAuthEvent(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
