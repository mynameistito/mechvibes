import { createRoot } from 'react-dom/client';
import { EditorWindow } from './EditorWindow';
import '../tailwind.css';

createRoot(document.getElementById('app-root')!).render(<EditorWindow />);
