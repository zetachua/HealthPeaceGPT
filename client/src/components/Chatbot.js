import { 
  CssBaseline, 
  Box, 
  Typography, 
  TextField, 
  IconButton, 
  Paper, 
  useMediaQuery, 
  useTheme,
  Drawer,
  AppBar,
  Toolbar,
} from "@mui/material";
import SendIcon from '@mui/icons-material/Send';
import MenuIcon from '@mui/icons-material/Menu';
import SideBar from "./SideBar";
import PDFViewer from "./PDFViewer";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLayout } from "../context/LayoutContext";

export const API_BASE_URL = 'https://server-floral-firefly-2320.fly.dev';

export default function Chatbot() {
  const [isUploading, setIsUploading] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const { isPDFOpen } = useLayout();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const warmGreyColor = "#E9ECEF";
  const textColor = "#2A2A2A";
  const mintColor = "#D9FFEA";

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  function TypewriterMarkdown({ text = "", components, speed = 20, onDone }) {
    const [displayed, setDisplayed] = useState("");
  
    useEffect(() => {
      let i = 0;
      const interval = setInterval(() => {
        setDisplayed(text.slice(0, i + 1));
        i++;
        if (i >= text.length) {
          clearInterval(interval);
          onDone?.(); // mark as completed
        }
      }, speed);
  
      return () => clearInterval(interval);
// eslint-disable-next-line
    }, [messages]);
  
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {displayed}
      </ReactMarkdown>
    );
  }
  
  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = { role: "user", content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput("");

    const loadingMessage = { role: "assistant", content: "AI is thinking...", isLoading: true };
    setMessages(prev => [...prev, loadingMessage]);

    try {
      const res = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });
      
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error("Invalid server response");
      }
      
      const safeAnswer =
        res.ok && data?.answer
          ? data.answer
          : "Sorry — I couldn’t retrieve an answer.";
      
      setMessages(prev =>
        prev.map(msg =>
          msg.isLoading
            ? { role: "assistant", content: safeAnswer, hasTyped: false }
            : msg
        )
      );
          
      
    } catch (err) {
      console.error(err);
      setMessages(prev =>
        prev.map(msg =>
          msg.isLoading ? { role: "assistant", content: "Sorry, something went wrong." ,hasTyped: false} : msg
        )
      );
    }
  };

  const handleDrawerToggle = () => {
    if (isUploading) {
      console.log("Preventing drawer close during upload");
      return;
    }
    setMobileOpen(!mobileOpen);
  };

  const drawer = (
    <Box sx={{ width: 280 }}>
      <SideBar 
        textColor={textColor} 
        setIsUploading={setIsUploading}
        onMobileUploadComplete={() => {
          setTimeout(() => {
            setMobileOpen(false);
            setIsUploading(false);
          }, 500);
        }}
      />
    </Box>
  );

  // Don't show backdrop on mobile
  const showBackdrop = isPDFOpen && !isMobile;

  return (
    <>
      <CssBaseline />
      
      {/* Mobile App Bar - Hide when PDF is open so X button is visible */}
      {isMobile && !isPDFOpen && (
        <AppBar 
          position="fixed" 
          sx={{ 
            display: { xs: 'block', md: 'none' },
            backgroundColor: 'white',
            color: textColor,
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}
        >
          <Toolbar sx={{ minHeight: '56px' }}>
            <IconButton
              color="inherit"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>
            <Typography 
              fontFamily="MadeTommy" 
              variant="body1" 
              sx={{ flexGrow: 1 }}
            >
              HealthPeaceGPT
            </Typography>
          </Toolbar>
        </AppBar>
      )}

      {/* Mobile Sidebar Drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={handleDrawerToggle}
        ModalProps={{ 
          keepMounted: true,
          disableBackdropClick: isUploading,
          disableEscapeKeyDown: isUploading,
        }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { 
            boxSizing: 'border-box', 
            width: 280,
            backgroundColor: 'white',
            position: 'fixed',
          },
        }}
      >
        {drawer}
      </Drawer>

      {/* Subtle backdrop overlay when PDF is open (desktop only) */}
      {showBackdrop && (
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
            pointerEvents: "none",
          }}
        />
      )}

      {/* Root container - Responsive layout */}
      <Box 
        sx={{
          display: 'flex',
          height: '100vh',
          width: '100vw',
          bgcolor: warmGreyColor,
          flexDirection: { xs: 'column', md: 'row' },
          position: 'relative',
          pt: { xs: isPDFOpen ? 0 : '56px', md: 0 },
        }}
      >
        {/* Sidebar - hidden on mobile (shown in drawer), visible on desktop */}
        <Box
          sx={{
            display: { xs: 'none', md: 'block' },
            flexShrink: 0,
            zIndex: 2,
          }}
        >
          <SideBar 
            textColor={textColor}
            setIsUploading={setIsUploading}
          />
        </Box>

        {/* PDF Viewer - full screen on mobile */}
        {isPDFOpen && (
          <Box
            sx={{
              width: { xs: '100%', md: '600px' },
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
              zIndex: 1000,
              height: { xs: '100vh', md: '100vh' },
              position: 'relative',
            }}
          >
            <PDFViewer />
          </Box>
        )}

        {/* Chat Window - Centered layout with smaller text */}
        <Box 
          sx={{ 
            flex: 1,
            display: "flex",
            flexDirection: "column",
            p: { xs: 2, md: 4 },
            overflow: "hidden",
            width: '100%',
            position: 'relative',
            zIndex: 1,
            height: { xs: isPDFOpen ? '100vh' : 'calc(100vh - 56px)', md: '100vh' },
          }}
        >
          {/* Header - Show on both mobile and desktop */}
          {!isPDFOpen && (
            <Typography 
              fontFamily="MadeTommy" 
              variant={isMobile ? "body2" : "caption"} 
              color={textColor} 
              mb={isMobile ? 2 : 3}
              sx={{ 
                fontSize: { xs: '11px', md: '12px' },
              }}
            >
              Brian's ChatGPT
            </Typography>
          )}

          {/* Chat messages container - CENTERED with smaller text */}
          <Paper
            sx={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              p: { xs: 2, md: 2 },
              boxShadow: 'none',
              mb: { xs: 2, md: 2 },
              width: "100%",
              backgroundColor: 'transparent',
              overflowY: "auto",
              maxWidth: { xs: '100%', md: '800px' },
              margin: 'auto',
            }}
          >
           {messages.map((msg, i) => {
              const isLast = i === messages.length - 1; // check if this is the last message
              return (
                <Box
                  key={i}
                  display="flex"
                  justifyContent={msg.role === "user" ? "flex-end" : "flex-start"}
                  mb={2}
                >
                  <Paper
                    elevation={1}
                    sx={{
                      p: { xs: 1.5, md: 1.5 },
                      maxWidth: { xs: '85%', md: '80%' },
                      bgcolor: msg.role === "user" ? mintColor : "#F8F9FA",
                      borderRadius: 3,
                      boxShadow: 1,
                    }}
                  >
                   {msg.role === "assistant" ? (
                    msg.isLoading ? (
                      <Typography fontFamily="MadeTommy" fontSize="13px" color={textColor}>
                        {msg.content}
                      </Typography>
                    ) : isLast && !msg.hasTyped ? (
                      <TypewriterMarkdown
                        text={msg.content}
                        speed={1000}
                        onDone={() => {
                          setMessages(prev =>
                            prev.map((m, idx) =>
                              idx === i ? { ...m, hasTyped: true } : m
                            )
                          );
                        }}
                        components={{
                          p: ({ children }) => (
                            <Typography paragraph fontFamily="MadeTommy" fontSize="13px" color={textColor}>
                              {children}
                            </Typography>
                          ),
                          li: ({ children }) => (
                            <Typography component="li" fontFamily="MadeTommy" fontSize="13px">
                              {children}
                            </Typography>
                          ),
                          strong: ({ children }) => (
                            <Typography component="span" fontWeight="bold">
                              {children}
                            </Typography>
                          ),
                        }}
                      />
                    ) : (
                      <Typography fontFamily="MadeTommy" fontSize="13px" color={textColor}>
                        {msg.content}
                      </Typography>
                    )
                  ) : (
                    <Typography fontFamily="MadeTommy" fontSize="13px" color={textColor}>
                      {msg.content}
                    </Typography>
                  )}

                  </Paper>
                </Box>
              );
            })}

            <div ref={messagesEndRef} />
          </Paper>

          {/* Input bar - CENTERED and aligned with chat container */}
          <Box 
            display="flex" 
            alignItems="center" 
            gap={0.2} 
            width="100%"
            maxWidth={{ xs: '100%', md: '800px' }}
            margin="auto"
            sx={{
              transition: "transform 0.3s ease",
              "&:focus-within": {
                transform: { xs: 'none', md: 'translateY(-2px)' },
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
                sx: {
                  fontFamily: "MadeTommy",
                  padding: { xs: '0.4rem', md: '0.5rem' },
                  "& input": {
                    fontSize: { xs: '12px', md: '11px' },
                    textAlign: 'left',
                    fontFamily: "MadeTommy",
                    paddingLeft: { xs: '0.5rem', md: '0.8rem' },
                    '&::placeholder': {
                      fontSize: { xs: '12px', md: '11px' },
                      opacity: 0.7,
                    }
                  },
                },
              }}
              sx={{
                fontFamily: "MadeTommy",
                borderRadius: 5,
                bgcolor: "white",
                transition: "all 0.2s ease",
                "&:hover": {
                  boxShadow: { xs: 'none', md: "0 2px 8px rgba(0,0,0,0.05)" },
                },
                "&:focus-within": {
                  boxShadow: { xs: 'none', md: "0 4px 12px rgba(0,0,0,0.08)" },
                }
              }}
            />
            <IconButton 
              color="primary" 
              onClick={sendMessage}
              size="small"
              sx={{
                transition: "transform 0.2s ease",
                "&:hover": {
                  transform: { xs: 'none', md: "scale(1.1)" },
                }
              }}
            >
              <SendIcon fontSize="small" />
            </IconButton>
            {/* <IconButton 
              color="secondary"
              size="small"
              sx={{
                transition: "transform 0.2s ease",
                "&:hover": {
                  transform: { xs: 'none', md: "scale(1.1)" },
                }
              }}
            >
              <MicIcon fontSize="small" />
            </IconButton> */}
          </Box>

          {/* Footer text - responsive sizing */}
          <Typography 
            fontFamily="MadeTommy" 
            color="#7A7A7A" 
            textAlign={'center'} 
            sx={{ 
              paddingTop: { xs: '0.8rem', md: '1rem' },
              fontSize: { xs: '9px', md: '10px' }
            }} 
            opacity={0.6} 
            mt={1}
          >
            HealthPeaceGPT can make mistakes. Check important info.
          </Typography>
        </Box>
      </Box>
    </>
  );
}
