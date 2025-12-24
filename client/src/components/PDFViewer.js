import React from "react";
import { Box, IconButton, Typography } from "@mui/material";
import { Close as CloseIcon } from "@mui/icons-material";
import { useLayout } from "../context/LayoutContext";

export default function PDFViewer() {
  const { selectedPDF, closePDF } = useLayout();

  if (!selectedPDF) return null;

  const pdfUrl = `http://localhost:5001/pdf/${selectedPDF.id}`;

  return (
    <Box
      sx={{
        width: "600px", // Fixed width instead of percentage
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "white",
        boxShadow: "0px 0px 10px rgba(0,0,0,0.1)",
        borderLeft: "1px solid #E9ECEF",
      }}
    >
      {/* PDF Viewer Header */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          p: 2,
          borderBottom: "1px solid #E9ECEF",
        }}
      >
        <Typography fontFamily="MadeTommy" fontSize={14} fontWeight="bold" noWrap>
          {selectedPDF.name}
        </Typography>
        <IconButton onClick={closePDF} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* PDF Embed */}
      <Box sx={{ flex: 1, overflow: "hidden" }}>
        <embed
          src={pdfUrl}
          type="application/pdf"
          width="100%"
          height="100%"
          style={{ border: "none" }}
        />
      </Box>
    </Box>
  );
}
