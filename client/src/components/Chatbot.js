import { CssBaseline, Box, Typography, TextField, IconButton, Paper } from "@mui/material";
import MicIcon from '@mui/icons-material/Mic';
import SendIcon from '@mui/icons-material/Send';
import SideBar from "./SideBar";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Chatbot() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const messagesEndRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const warmGreyColor = "#E9ECEF";
  const textColor = "#2A2A2A";
  const mintColor = "#D9FFEA";

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  
function TypewriterMarkdown({ text, components, speed = 50 }) {
  const [displayed, setDisplayed] = useState("");

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      setDisplayed(text.slice(0, i + 1));
      i++;
      if (i >= text.length) clearInterval(interval);
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed]);

  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{displayed}</ReactMarkdown>;
}

  
const sendMessage = async () => {
  if (!input.trim()) return;

  const userMessage = { role: "user", content: input };
  setMessages(prev => [...prev, userMessage]);
  setInput("");

  // Show AI thinking indicator
  const loadingMessage = { role: "assistant", content: "AI is thinking...", isLoading: true };
  setMessages(prev => [...prev, loadingMessage]);
  setLoading(true);

  try {
    const res = await fetch("http://localhost:5001/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input }),
    });
    const data = await res.json();

    // Replace loading message with actual assistant text
    setMessages(prev =>
      prev.map(msg =>
        msg.isLoading ? { role: "assistant", content: data.answer } : msg
      )
    );
    console.log(loading,"logging")
  } catch (err) {
    console.error(err);
    setMessages(prev =>
      prev.map(msg =>
        msg.isLoading ? { role: "assistant", content: "Sorry, something went wrong." } : msg
      )
    );
  } finally {
    setLoading(false);
  }
};


  return (
    <>
      <CssBaseline />
      <Box display="flex" height="100vh" width="100vw" bgcolor={warmGreyColor}>
        {/* Left Sidebar */}
        <SideBar textColor={textColor} />

        {/* Main Chat Screen */}
        <Box flexGrow={1} display="flex" flexDirection="column" p={4}>
          <Typography fontFamily="MadeTommy" variant="caption" color={textColor} mb={3}>
            Brian's ChatGPT
          </Typography>

          {/* Chat messages container */}
          <Paper
            sx={{
              flexGrow: 1,
              display: "flex",
              flexDirection: "column",
              p: 2,
              boxShadow:'none',
              mb: 2,
              width:"60vw" ,
              margin:'auto',
              backgroundColor:'transparent',
              maxHeight: "70vh",
              overflowY: "auto",
            }}
          >
            {messages.map((msg, i) => (
              <Box
                key={i}
                display="flex"
                justifyContent={msg.role === "user" ? "flex-end" : "flex-start"}
                mb={2}
              >
                <Paper
                  elevation={1}
                  sx={{
                    p: 2,
                    maxWidth: "80%",
                    bgcolor: msg.role === "user" ? mintColor : "#F8F9FA",
                    borderRadius: 3,
                    boxShadow: 1,
                  }}
                >
                  {msg.role === "assistant" ? (
                  msg.isLoading ? (
                    <Typography fontFamily="MadeTommy" fontSize={15} variant="caption"color={textColor} >
                      {msg.content} 
                    </Typography>
                  ) : (
                    <TypewriterMarkdown
                      text={msg.content}
                      components={{
                        p: ({ children }) => (
                          <Typography paragraph fontFamily="MadeTommy" fontSize={15} color={textColor} sx={{ mb: 1.5 }}>
                            {children}
                          </Typography>
                        ),
                        ul: ({ children }) => <Box component="ul" sx={{ pl: 2, my: 1.5 }}>{children}</Box>,
                        ol: ({ children }) => <Box component="ol" sx={{ pl: 2, my: 1.5 }}>{children}</Box>,
                        li: ({ children }) => (
                          <Typography component="li" fontFamily="MadeTommy" fontSize={15} color={textColor} sx={{ mb: 0.5 }}>
                            {children}
                          </Typography>
                        ),
                        strong: ({ children }) => <Typography fontWeight="bold" component="span">{children}</Typography>,
                        h1: ({ children }) => (
                          <Typography variant="h6" fontWeight="bold" mt={3} mb={1.5} fontFamily="MadeTommy">{children}</Typography>
                        ),
                        h2: ({ children }) => (
                          <Typography variant="subtitle1" fontWeight="bold" mt={2.5} mb={1} fontFamily="MadeTommy">{children}</Typography>
                        ),
                      }}
                      speed={20} // adjust typing speed
                    />
                  )
                ) : (
                  <Typography fontFamily="MadeTommy" fontSize={15} color={textColor}>
                    {msg.content}
                  </Typography>
                )}
                
                </Paper>
              </Box>
            ))}
            <div ref={messagesEndRef} />
          </Paper>

          {/* Input bar */}
          <Box display="flex" alignItems="center" gap={0.2} width="60vw" margin="auto">
            <TextField
              placeholder=" Ask Anything..."
              variant="standard"
              fullWidth
              size="small"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { // prevent new line triggers
                  e.preventDefault(); // STOP page reload
                  sendMessage();
                }
              }}
              InputProps={{
                disableUnderline: true,
                style: {
                  fontSize: '12px',
                  padding: '0.7rem',
                  textAlign: 'center',
                },
              }}
              sx={{
                fontFamily: "MadeTommy",
                borderRadius: 5,
                bgcolor: "white",
              }}
            />
            <IconButton color="primary" onClick={sendMessage}>
              <SendIcon />
            </IconButton>
            <IconButton color="secondary">
              <MicIcon />
            </IconButton>
          </Box>

          <Typography fontFamily="MadeTommy" color="#7A7A7A" textAlign={'center'} sx={{paddingTop:'1rem'}}fontSize={10} opacity={0.6} mt={1}>
          Brian's ChatGPT can make mistakes. Check important info.
          </Typography>
        </Box>
      </Box>
    </>
  );
}
