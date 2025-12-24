import { CssBaseline, Box, Typography, TextField, IconButton, Paper } from "@mui/material";
import MicIcon from '@mui/icons-material/Mic';
import SendIcon from '@mui/icons-material/Send';
import SideBar from "./SideBar";
import PDFViewer from "./PDFViewer";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLayout } from "../context/LayoutContext";

export default function Chatbot() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const messagesEndRef = useRef(null);
  const { isPDFOpen } = useLayout();

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

    const loadingMessage = { role: "assistant", content: "AI is thinking...", isLoading: true };
    setMessages(prev => [...prev, loadingMessage]);

    try {
      const res = await fetch("http://localhost:5001/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });
      const data = await res.json();

      setMessages(prev =>
        prev.map(msg =>
          msg.isLoading ? { role: "assistant", content: data.answer } : msg
        )
      );
    } catch (err) {
      console.error(err);
      setMessages(prev =>
        prev.map(msg =>
          msg.isLoading ? { role: "assistant", content: "Sorry, something went wrong." } : msg
        )
      );
    }
  };

  return (
    <>
      <CssBaseline />
      
      {/* Subtle backdrop overlay when PDF is open */}
      {isPDFOpen && (
        <Box
          sx={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.03)",
            zIndex: 0,
            opacity: isPDFOpen ? 1 : 0,
            transition: "opacity 0.3s ease",
            pointerEvents: "none", // Allow clicks to pass through
          }}
        />
      )}

      {/* Root container - Fixed width sidebar + flexible content */}
      <Box display="flex" height="100vh" width="100vw" bgcolor={warmGreyColor} position="relative">
        {/* Fixed Sidebar - Always 280px */}
        <Box sx={{ flexShrink: 0, zIndex: 2 }}>
          <SideBar textColor={textColor} />
        </Box>

        {/* PDF Viewer - Appears when needed with smooth animation */}
        {isPDFOpen && (
          <Box sx={{ flexShrink: 0, zIndex: 2 }}>
            <PDFViewer />
          </Box>
        )}

        {/* Chat Window - Takes remaining space with smooth transition */}
        <Box 
          sx={{ 
            flex: 1,
            display: "flex",
            flexDirection: "column",
            p: 4,
            overflow: "hidden",
            minWidth: 0,
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            zIndex: 1,
          }}
        >
          <Typography fontFamily="MadeTommy" variant="caption" color={textColor} mb={3}>
            Brian's ChatGPT
          </Typography>

          {/* Chat messages container */}
          <Paper
            sx={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              p: 2,
              boxShadow: 'none',
              mb: 2,
              width: "100%",
              maxWidth: "800px",
              margin: 'auto',
              backgroundColor: 'transparent',
              overflowY: "auto",
              transition: "width 0.3s ease",
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
                    transition: "transform 0.2s ease",
                    "&:hover": {
                      transform: "translateY(-1px)",
                    }
                  }}
                >
                  {msg.role === "assistant" ? (
                    msg.isLoading ? (
                      <Typography fontFamily="MadeTommy" fontSize={15} variant="caption" color={textColor} >
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
                        speed={20}
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

          {/* Input bar with subtle animation */}
          <Box 
            display="flex" 
            alignItems="center" 
            gap={0.2} 
            width="100%" 
            maxWidth="800px" 
            margin="auto"
            sx={{
              transition: "transform 0.3s ease",
              "&:focus-within": {
                transform: "translateY(-2px)",
              }
            }}
          >
            <TextField
              placeholder=" Ask Anything..."
              variant="standard"
              fullWidth
              size="small"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
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
                transition: "all 0.2s ease",
                "&:hover": {
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                },
                "&:focus-within": {
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }
              }}
            />
            <IconButton 
              color="primary" 
              onClick={sendMessage}
              sx={{
                transition: "transform 0.2s ease",
                "&:hover": {
                  transform: "scale(1.1)",
                }
              }}
            >
              <SendIcon />
            </IconButton>
            <IconButton 
              color="secondary"
              sx={{
                transition: "transform 0.2s ease",
                "&:hover": {
                  transform: "scale(1.1)",
                }
              }}
            >
              <MicIcon />
            </IconButton>
          </Box>

          <Typography 
            fontFamily="MadeTommy" 
            color="#7A7A7A" 
            textAlign={'center'} 
            sx={{ paddingTop: '1rem' }} 
            fontSize={10} 
            opacity={0.6} 
            mt={1}
          >
            Brian's ChatGPT can make mistakes. Check important info.
          </Typography>
        </Box>
      </Box>
    </>
  );
}
