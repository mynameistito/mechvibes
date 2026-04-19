import { createRoot } from 'react-dom/client';
import { InstallWindow } from './InstallWindow';
import '../tailwind.css';

createRoot(document.getElementById('app-root')!).render(<InstallWindow />);
