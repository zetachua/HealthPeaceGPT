import {  CssBaseline, Box, Typography, TextField, IconButton, Paper } from "@mui/material";
import MicIcon from '@mui/icons-material/Mic';
import SendIcon from '@mui/icons-material/Send';
import SideBar from "./SideBar";

export default function Chatbot() {

    //colors
    const warmGreyColor="#E9ECEF";
    const textColor="#2A2A2A";
    const mintColor="#D9FFEA";

  return (
    <>
      <CssBaseline />

      <Box display="flex" height="100vh" width="100vw" bgcolor={warmGreyColor}>

        {/* ───────── Left Sidebar ───────── */}
        <SideBar textColor={textColor}/>

        {/* ───────── Main Chat Screen ───────── */}
        <Box flexGrow={1} display="flex" flexDirection="column" alignItems="center" justifyContent="center">

          <Typography fontFamily={"MadeTommy"} variant="h5" color={textColor} mb={3}>
            Welcome to Brian’s Personalized Longevity AI Health System
          </Typography>

          <Paper 
            sx={{
              width:"480px",
              display:"flex",
              alignItems:"center",
              px:2, py:1,
              borderRadius:"40px",
              background:"white"
            }}
          >
            <TextField 
              placeholder="Ask Anything..."
              variant="standard"
              fullWidth
              InputProps={{ disableUnderline:true, style:{ fontFamily:"MadeTommy" }}}
            />

            <IconButton color="inherit"><MicIcon/></IconButton>
            <IconButton sx={{ bgcolor:{mintColor} }}><SendIcon/></IconButton>
          </Paper>

          <Typography fontFamily={"MadeTommy"} fontSize={10} opacity={0.6} mt={2}>
            HealthPeaceGPT can make mistakes. Check important info.
          </Typography>

        </Box>
      </Box>
      </>
  );
}
