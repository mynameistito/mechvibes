import { createRoot } from 'react-dom/client';
import { DebugConsole } from './DebugConsole';
import '../tailwind.css';

const root = document.getElementById('app-root')!;
createRoot(root).render(<DebugConsole />);
