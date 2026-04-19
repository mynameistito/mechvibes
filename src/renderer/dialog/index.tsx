import { createRoot } from 'react-dom/client';
import { Dialog } from './Dialog';
import '../tailwind.css';

const root = document.getElementById('dialog-root')!;
createRoot(root).render(<Dialog />);
