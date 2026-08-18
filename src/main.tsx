import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AreaExplorePage from './pages/AreaExplorePage.tsx';
import './index.css';

const isAreaExplorePage = window.location.pathname.startsWith('/explore/areas/');
const RootComponent = isAreaExplorePage ? AreaExplorePage : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
);
