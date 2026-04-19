import { createRoot } from 'react-dom/client';
import { AppWindow } from './AppWindow';
import '../tailwind.css';

createRoot(document.getElementById('app-root')!).render(<AppWindow />);
