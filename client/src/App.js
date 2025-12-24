import './App.css';
import { LayoutProvider } from './context/LayoutContext';
import Chatbot from './components/Chatbot';

function App() {
  return (
    <LayoutProvider>
      <Chatbot />
    </LayoutProvider>
  );
}

export default App;
