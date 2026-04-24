import React from 'react';
import { useStore } from './store/useStore';
import Login from './pages/Login';
import Main from './pages/Main';

export default function App() {
  const token = useStore(s => s.token);
  return token ? <Main /> : <Login />;
}
