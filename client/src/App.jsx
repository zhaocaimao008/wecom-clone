import React from 'react';
import { useStore } from './store/useStore';
import Login from './pages/Login';
import Main from './pages/Main';

export default function App() {
  const token = useStore(s => s.token);
  const showAddAccount = useStore(s => s.showAddAccount);
  const hideAddAccountModal = useStore(s => s.hideAddAccountModal);

  return (
    <>
      {token ? <Main /> : <Login />}
      {token && showAddAccount && (
        <div className="add-account-overlay" onClick={e => { if (e.target === e.currentTarget) hideAddAccountModal(); }}>
          <div className="add-account-modal">
            <Login isModal onClose={hideAddAccountModal} />
          </div>
        </div>
      )}
    </>
  );
}
