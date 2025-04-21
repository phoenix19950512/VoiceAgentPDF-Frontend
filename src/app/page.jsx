import VoiceAssistant from './VoiceAssistant';

export const metadata = {
  title: "AI Voice Assistant",
  description: "Real-time AI Voice Assistant powered by OpenAI's inference technology, Deepgram's AI voice models and Meta Llama 3.",
  openGraph: {
    title: "AI Voice Assistant",
    description: "Real-time AI Voice Assistant powered by OpenAI's inference technology, Deepgram's AI voice models and Meta Llama 3.",
    url : "http://localhost:3000",
    siteName: "AI Voice Assistant",
    type: "website",
  },
};


function App() {
  return <VoiceAssistant />;
}

export default App;