import React from "react";
import { Box, IconButton, Typography } from "@mui/material";
import { ArrowBack as ArrowBackIcon } from "@mui/icons-material";
import { useLayout } from "../context/LayoutContext";
import { API_BASE_URL } from "./Chatbot";

export default function PDFViewer() {
  const { selectedPDF, closePDF } = useLayout();

  if (!selectedPDF) return null;

  const pdfUrl = `${API_BASE_URL}/pdf/${selectedPDF.id}`;

  return (
    <Box
      sx={{
        width: { xs: "100%", md: "600px" },
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "white",
        boxShadow: "0px 0px 10px rgba(0,0,0,0.1)",
        borderLeft: { xs: "none", md: "1px solid #E9ECEF" },
        position: "relative",
        zIndex: 9999,
      }}
    >
      {/* PDF Viewer Header with Back Button */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          p: 2,
          borderBottom: "1px solid #E9ECEF",
          backgroundColor: "white",
          position: "sticky",
          top: 0,
          zIndex: 10000,
        }}
      >
        {/* Back Button */}
        <IconButton 
          onClick={closePDF} 
          size="small"
          sx={{ mr: 2 }}
        >
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        
        {/* PDF Name */}
        <Typography 
          fontFamily="MadeTommy" 
          fontSize={14} 
          fontWeight="bold" 
          noWrap
          sx={{ 
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis"
          }}
        >
          {selectedPDF.name}
        </Typography>
      </Box>

      {/* PDF Embed */}
      <Box sx={{ 
        flex: 1, 
        overflow: "hidden",
        WebkitOverflowScrolling: "touch",
      }}>
        <iframe
          src={pdfUrl}
          title={selectedPDF.name}
          width="100%"
          height="100%"
          style={{ border: "none" }}
          allowFullScreen
        />
      </Box>
    </Box>
  );
}
