'use client';

import { useState, useReducer, useRef, useLayoutEffect } from 'react';
import Image from 'next/image';
import conversationReducer from './conversationReducer';
import micIcon from '/public/mic.svg';
import micOffIcon from '/public/mic-off.svg';
import PdfIcon from '../icons/pdfIcon';
import SendIcon from '../icons/sendIcon';

const initialConversation = { messages: [], finalTranscripts: [], interimTranscript: '' };

function VoiceAssistant() {
  const [conversation, dispatch] = useReducer(conversationReducer, initialConversation);
  const [isRunning, setIsRunning] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [uploadedPdf, setUploadedPdf] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [typingMessage, setTypingMessage] = useState('');
  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaSourceRef = useRef(null);
  const sourceBufferRef = useRef(null);
  const audioElementRef = useRef(null);
  const audioDataRef = useRef([]);
  const messagesEndRef = useRef(null);
  const sessionIdRef = useRef(generateSessionId());

  // Automatically scroll to bottom message
  useLayoutEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation]);

  function generateSessionId() {
    return 'session_' + Math.random().toString(36).substring(2, 15);
  }

  async function uploadPdf(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      alert('Please select a valid PDF file');
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('session_id', sessionIdRef.current);

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const response = await fetch(`${apiUrl}/upload`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        setUploadedPdf({
          name: file.name,
          filePath: result.file_path
        });
      } else {
        throw new Error(result.error || 'Failed to upload PDF');
      }
    } catch (error) {
      console.error('Error uploading PDF:', error);
      alert('Failed to upload PDF: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (file) {
      uploadPdf(file);
    }
  }

  function clearUploadedPdf() {
    setUploadedPdf(null);
  }
  function openWebSocketConnection() {
    const ws_url = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'ws://localhost:8000/listen';
    wsRef.current = new WebSocket(ws_url);
    wsRef.current.binaryType = 'arraybuffer';

    wsRef.current.onopen = () => {
      const initialMessage = uploadedPdf
        ? { file_path: uploadedPdf.filePath }
        : { init: true }; // Empty object or some flag to indicate no PDF

      wsRef.current.send(JSON.stringify(initialMessage));
      setIsConnected(true);
    };

    function handleAudioStream(streamData) {
      audioDataRef.current.push(new Uint8Array(streamData));
      if (sourceBufferRef.current && !sourceBufferRef.current.updating) {
        sourceBufferRef.current.appendBuffer(audioDataRef.current.shift());
      }
    }

    function handleJsonMessage(jsonData) {
      const message = JSON.parse(jsonData);
      if (message.type === 'finish') {
        endConversation();
      } else {
        // If user interrupts while audio is playing, skip the audio currently playing
        if (message.type === 'transcript_final' && isAudioPlaying()) {
          skipCurrentAudio();
        }
        dispatch(message);
      }
    }

    wsRef.current.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        handleAudioStream(event.data);
      } else {
        handleJsonMessage(event.data);
      }
    };

    wsRef.current.onclose = () => {
      endConversation();
      setIsConnected(false);
    }
  }

  function closeWebSocketConnection() {
    clearUploadedPdf();
    if (wsRef.current) {
      wsRef.current.close();
    }
  }

  async function startMicrophone() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorderRef.current = new MediaRecorder(stream);
    mediaRecorderRef.current.addEventListener('dataavailable', e => {
      if (e.data.size > 0 && wsRef.current.readyState == WebSocket.OPEN) {
        wsRef.current.send(e.data);
      }
    });
    mediaRecorderRef.current.start(250);
  }

  function stopMicrophone() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.stream) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  }

  function startAudioPlayer() {
    // Initialize MediaSource and event listeners
    mediaSourceRef.current = getMediaSource();
    if (!mediaSourceRef.current) {
      return;
    }

    mediaSourceRef.current.addEventListener('sourceopen', () => {
      if (!MediaSource.isTypeSupported('audio/mpeg')) return;

      sourceBufferRef.current = mediaSourceRef.current.addSourceBuffer('audio/mpeg');
      sourceBufferRef.current.addEventListener('updateend', () => {
        if (audioDataRef.current.length > 0 && !sourceBufferRef.current.updating) {
          sourceBufferRef.current.appendBuffer(audioDataRef.current.shift());
        }
      });
    });

    // Initialize Audio Element
    const audioUrl = URL.createObjectURL(mediaSourceRef.current);
    audioElementRef.current = new Audio(audioUrl);
    audioElementRef.current.play();
  }

  function isAudioPlaying() {
    return audioElementRef.current.readyState === HTMLMediaElement.HAVE_ENOUGH_DATA;
  }

  function skipCurrentAudio() {
    audioDataRef.current = [];
    const buffered = sourceBufferRef.current.buffered;
    if (buffered.length > 0) {
      if (sourceBufferRef.current.updating) {
        sourceBufferRef.current.abort();
      }
      audioElementRef.current.currentTime = buffered.end(buffered.length - 1);
    }
  }

  function stopAudioPlayer() {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      URL.revokeObjectURL(audioElementRef.current.src);
      audioElementRef.current = null;
    }

    if (mediaSourceRef.current) {
      if (sourceBufferRef.current) {
        mediaSourceRef.current.removeSourceBuffer(sourceBufferRef.current);
        sourceBufferRef.current = null;
      }
      mediaSourceRef.current = null;
    }

    audioDataRef.current = [];
  }

  async function startConversation() {
    dispatch({ type: 'reset' });
    try {
      if (!isConnected) {
        openWebSocketConnection();
      }
      await startMicrophone();
      startAudioPlayer();
      setIsRunning(true);
      setIsListening(true);
    } catch (err) {
      console.log('Error starting conversation:', err);
      endConversation();
    }
  }

  function endConversation() {
    closeWebSocketConnection();
    stopMicrophone();
    stopAudioPlayer();
    setIsRunning(false);
    setIsListening(false);
  }

  function toggleListening() {
    if (isListening) {
      mediaRecorderRef.current.pause();
    } else {
      mediaRecorderRef.current.resume();
    }
    setIsListening(!isListening);
  }

  function waitForWebSocket() {
    return new Promise(resolve => {
      const interval = setInterval(() => {
        if (wsRef.current && wsRef.current.readyState === 1) {
          clearInterval(interval);
          resolve(true);
        }
      }, 100);
    });
  }

  async function handleSendMessage() {
    if (!typingMessage.trim()) return;
    setIsLoading(true);
    if (!isConnected) {
      openWebSocketConnection();
      await waitForWebSocket();
    }
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'speech_final', content: typingMessage }));
    }
    dispatch({ type: 'transcript_final', content: typingMessage });
    setTypingMessage('');
    setIsLoading(false);
  }

  const currentTranscript = [...conversation.finalTranscripts, conversation.interimTranscript].join(' ');

  return (
    <div className='w-full min-h-screen bg-gradient-to-b from-primary-orange/50 to-primary-orange/10'>
      <div className='flex flex-col justify-between w-full min-h-screen max-w-3xl mx-auto px-4'>
        <header className='flex flex-col gap-0.5 pt-4 text-center'>
          <h1 className='font-urbanist text-[1.65rem] font-semibold'>AI Voice Assistant</h1>
        </header>
        <div className='flex flex-col items-start py-4 rounded-lg space-y-3 mt-0 mb-auto'>
          {conversation.messages.map(({ role, content }, idx) => (
            <div key={idx} className={role === 'user' ? 'user-bubble' : 'assistant-bubble'}>
              {content}
            </div>
          ))}
          {currentTranscript && (
            <div className='user-bubble'>{currentTranscript}</div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="py-4">
          {!uploadedPdf ? (!isRunning && !isConnected) && (
            <label className='flex flex-col items-center justify-center cursor-pointer max-w-md mx-auto relative text-orange-500 px-6 py-4 rounded-lg border border-orange-500 border-dashed hover:bg-white hover:text-orange-500 transition-all duration-300'>
              <PdfIcon className="my-2 w-10 h-10" />
              <div className="text-lg text-black my-2">Upload a PDF file</div>
              <p className="text-sm text-black my-2">Drag and drop or click to upload</p>
              <input
                type='file'
                accept='.pdf'
                onChange={handleFileChange}
                disabled={isUploading || isRunning}
                className='opacity-0 absolute inset-0 cursor-pointer'
              />
            </label>
          ) : (
            <div className='flex items-center justify-between max-w-md mx-auto bg-white rounded-lg p-4'>
              <div className='flex items-center gap-2'>
                <PdfIcon className="w-5 h-5 text-orange-500" />
                <span className='text-sm font-medium'>{uploadedPdf.name}</span>
              </div>
              {!isRunning && (
                <button
                  onClick={clearUploadedPdf}
                  className='text-orange-500 hover:text-orange-700 text-sm transition-all duration-300'
                >
                  Remove
                </button>
              )}
            </div>
          )}
          <div className={`flex flex-col justify-center items-center pt-16 pb-4`}>
            <div className={`wave ${isRunning ? 'running' : ''}`} />
            <p className='mt-12 text-[13px] text-orange-500'>
              {isRunning
                ? 'You can also end the conversation by saying "bye" or "goodbye"'
                : 'Click here to start a voice conversation with the assistant'
              }
            </p>
            <div className='flex items-center mt-3 gap-6'>
              <button
                className='w-48 border border-orange-500 text-orange-500 font-semibold px-4 py-1 rounded-2xl hover:bg-orange-500/5'
                onClick={isRunning ? endConversation : startConversation}
                disabled={isUploading}
              >
                {isRunning ? 'End conversation' : 'Start conversation'}
              </button>
              <button
                className='h-9 w-9 flex justify-center items-center bg-orange-500 rounded-full shadow-lg hover:opacity-70 disabled:opacity-70'
                onClick={toggleListening}
                disabled={!isRunning}
              >
                <Image src={isListening ? micIcon : micOffIcon} height={21} width={21} alt='microphone' />
              </button>
            </div>
            <div className="mt-4 flex items-center gap-3 w-full mx-auto">
              <input
                type="text"
                placeholder='Type a message instead...'
                className='w-full border border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500 rounded-lg p-2 transition-all duration-300'
                value={typingMessage}
                disabled={isLoading}
                onChange={(e) => setTypingMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'NumpadEnter') {
                    handleSendMessage();
                  }
                }}
              />
              <button
                className='bg-orange-500 text-white p-2.5 rounded-lg'
                onClick={handleSendMessage}
                disabled={isLoading}
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getMediaSource() {
  if ('MediaSource' in window) {
    return new MediaSource();
  } else if ('ManagedMediaSource' in window) {
    // Use ManagedMediaSource if available in iPhone
    return new ManagedMediaSource();
  } else {
    console.log('No MediaSource API available');
    return null;
  }
}

export default VoiceAssistant;