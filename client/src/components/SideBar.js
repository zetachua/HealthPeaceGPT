import {
  Box,
  Typography,
  Button,
  TextField,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
} from "@mui/material";
import { FileUpload, Delete as DeleteIcon, Close as CloseIcon } from "@mui/icons-material";
import { useState, useRef, useEffect } from "react";
import { useLayout } from "../context/LayoutContext";
import { API_BASE_URL } from "./Chatbot";

export default function SideBar({ textColor, onMobileUploadComplete, setIsUploading }) {
  const fileInputRef = useRef(null);
  const { openPDF, files, refreshFiles, setFiles } = useLayout();

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showSelectedFiles, setShowSelectedFiles] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ 
    success: 0, 
    failed: 0,
    currentFile: "",
    errorMessage: ""
  });

  // Keep upload section open when uploading
  useEffect(() => {
    if (uploading && selectedFiles.length > 0) {
      setShowSelectedFiles(true);
    }
  }, [uploading, selectedFiles.length]);

  // Handle file selection (multiple files)
  const handleFileSelect = (event) => {
    const selected = Array.from(event.target.files);
    if (selected.length > 0) {
      setSelectedFiles(selected);
      setShowSelectedFiles(true);
      setUploadStatus({ success: 0, failed: 0, currentFile: "", errorMessage: "" });
    }
  };

  // Test server connection
  const testServerConnection = async () => {
    try {
      console.log(`Testing connection to: ${API_BASE_URL}`);
      const response = await fetch(`${API_BASE_URL}/`, {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      });
      console.log("Server connection test:", response.status, response.statusText);
      return response.ok;
    } catch (error) {
      console.error("Server connection failed:", error);
      return false;
    }
  };

  // Upload multiple files
  const handleUpload = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (selectedFiles.length === 0) return;

    console.log("=== UPLOAD STARTING ===");
    console.log("Using API URL:", API_BASE_URL);

    // Set upload state immediately
    setUploading(true);
    if (setIsUploading) {
      setIsUploading(true);
    }
    setUploadStatus({ 
      success: 0, 
      failed: 0,
      currentFile: "Testing server connection...",
      errorMessage: ""
    });
    
    // First test server connection
    const serverAvailable = await testServerConnection();
    if (!serverAvailable) {
      console.error(`Server at ${API_BASE_URL} is not available!`);
      setUploadStatus({ 
        success: 0, 
        failed: selectedFiles.length,
        currentFile: "",
        errorMessage: `Cannot connect to server at ${API_BASE_URL}. Make sure backend is running.`
      });
      setUploading(false);
      if (setIsUploading) setIsUploading(false);
      return;
    }

    console.log("Server is available, starting upload...");
    
    // Store files locally
    const filesToUpload = [...selectedFiles];
    let successfulUploads = 0;
    let failedUploads = 0;

    try {
      // Upload files sequentially
      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];
        
        // Update status
        setUploadStatus({ 
          success: successfulUploads, 
          failed: failedUploads,
          currentFile: `Uploading: ${file.name}`,
          errorMessage: ""
        });

        try {
          // Create FormData and send file directly to backend
          const formData = new FormData();
          formData.append("file", file);

          console.log(`Uploading file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

          const response = await fetch(`${API_BASE_URL}/upload-and-ingest`, {
            method: "POST",
            body: formData
          });

          console.log(`Response:`, response.status, response.statusText);

          if (response.ok) {
            successfulUploads++;
            console.log(`✓ Upload successful`);
          } else {
            let errorText = "";
            try {
              errorText = await response.text();
            } catch (textError) {
              errorText = "Could not read error response";
            }
            
            console.error(`✗ Upload failed:`, response.status, errorText);
            failedUploads++;
            
            setUploadStatus(prev => ({
              ...prev,
              errorMessage: `Server error: ${response.status}`
            }));
          }
        } catch (networkError) {
          console.error(`✗ Network error:`, networkError);
          failedUploads++;
          
          setUploadStatus(prev => ({
            ...prev,
            errorMessage: `Network error: ${networkError.message}`
          }));
        }
        
        // Update status after each file
        setUploadStatus({ 
          success: successfulUploads, 
          failed: failedUploads,
          currentFile: `Processed ${i + 1}/${filesToUpload.length} files`,
          errorMessage: ""
        });

        // Small delay between files
        if (i < filesToUpload.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      // Final status
      const finalMessage = successfulUploads > 0 
        ? `Uploaded ${successfulUploads} file(s) successfully!` 
        : "All uploads failed";
      
      console.log(`=== UPLOAD COMPLETE ===`);
      console.log(`Success: ${successfulUploads}, Failed: ${failedUploads}`);
      
      setUploadStatus({ 
        success: successfulUploads, 
        failed: failedUploads,
        currentFile: finalMessage,
        errorMessage: failedUploads > 0 ? `${failedUploads} file(s) failed to upload` : ""
      });

      // Refresh files if any succeeded
      if (successfulUploads > 0) {
        try {
          await refreshFiles();
        } catch (error) {
          console.error("Failed to refresh files:", error);
        }
      }

      // If successful, handle mobile completion
      if (successfulUploads > 0 && onMobileUploadComplete) {
        setTimeout(() => {
          onMobileUploadComplete();
        }, 2000);
      }
      
      // Clear selection after delay if successful
      if (successfulUploads > 0) {
        setTimeout(() => {
          setSelectedFiles([]);
          setShowSelectedFiles(false);
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }, 1500);
      }
      
    } catch (err) {
      console.error("Upload process error:", err);
      setUploadStatus({ 
        success: 0, 
        failed: filesToUpload.length,
        currentFile: "Upload process failed",
        errorMessage: err.message || "Unknown error"
      });
    } finally {
      setTimeout(() => {
        setUploading(false);
        if (setIsUploading) {
          setIsUploading(false);
        }
      }, 1000);
    }
  };

  // Cancel upload and clear selection
  const handleCancelUpload = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (!uploading) {
      setSelectedFiles([]);
      setShowSelectedFiles(false);
      setUploadStatus({ success: 0, failed: 0, currentFile: "", errorMessage: "" });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      
      if (setIsUploading) {
        setIsUploading(false);
      }
    }
  };

  // Delete file from server
  const handleDelete = async (id, e) => {
    e.preventDefault();
    e.stopPropagation();
  
    // Optimistically remove the file from UI
    const originalFiles = [...files];
    setFiles(prev => prev.filter(f => f.id !== id));
  
    try {
      const response = await fetch(`${API_BASE_URL}/delete/${id}`, {
        method: "DELETE",
      });
  
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
  
      // Refresh files from server just in case
      await refreshFiles();
    } catch (error) {
      console.error("Delete failed:", error);
  
      // Rollback if delete fails
      setFiles(originalFiles);
    }
  };

  // Handle PDF click
  const handlePDFClick = (file) => {
    openPDF(file);
  };

  const filteredFiles = files.filter((file) =>
    file.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );  

  return (
    <Box
      width="280px"
      bgcolor="white"
      p={3}
      boxShadow="2px 0px 10px #E9ECEF"
      display="flex"
      flexDirection="column"
      gap={2}
      onClick={(e) => e.stopPropagation()}
      sx={{
        height: "100vh",
        overflowY: "auto",
      }}
    >
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography fontFamily="MadeTommy" fontSize={13} opacity={0.7}>
            PDF Database
          </Typography>
          <Typography fontFamily="MadeTommy" fontSize={10} color="text.secondary">
            {files.length} files
          </Typography>
        </Box>

        {/* File Selection Button */}
        <Button
          component="label"
          size="small"
          startIcon={<FileUpload />}
          onClick={(e) => {
            e.stopPropagation();
            if (setIsUploading) {
              setIsUploading(true);
            }
          }}
          sx={{
            fontSize: "12px",
            fontFamily: "MadeTommy",
            py: 0.5,
            backgroundColor: "#D9FFEA",
            color: "#2A2A2A",
            textTransform: "none",
            fontWeight: "normal",
            letterSpacing: "normal",
            "& .MuiButton-startIcon": {
              marginRight: "4px",
            },
            "&:hover": {
              backgroundColor: "#C9EFDA",
            },
          }}
        >
          Select Files
          <input
            type="file"
            hidden
            accept=".pdf"
            onChange={handleFileSelect}
            ref={fileInputRef}
            multiple
          />
        </Button>
      </Box>

      {/* Selected Files List */}
      {(showSelectedFiles || selectedFiles.length > 0) && (
        <Box sx={{ mt: 1, border: "1px solid #E9ECEF", borderRadius: 1, p: 1.5 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography fontFamily="MadeTommy" fontSize={11} color="text.secondary">
              {uploading 
                ? `Uploading and Embedding Data...` 
                : `${selectedFiles.length} file(s) selected`}
            </Typography>
            {!uploading && (
              <IconButton
                size="small"
                onClick={handleCancelUpload}
                sx={{ 
                  padding: 0, 
                  color: "#666",
                  "& .MuiSvgIcon-root": {
                    fontSize: "16px",
                  }
                }}
              >
                <CloseIcon />
              </IconButton>
            )}
          </Box>
          
          {/* Current file being uploaded */}
          {uploading && uploadStatus.currentFile && (
            <Typography 
              fontFamily="MadeTommy" 
              fontSize={10} 
              color="text.secondary" 
              textAlign="center"
              mb={1}
              sx={{ fontStyle: 'italic' }}
            >
              {uploadStatus.currentFile}
            </Typography>
          )}
          
          <List dense sx={{ maxHeight: "150px", overflow: "auto", bgcolor: "#f9f9f9", borderRadius: 1 }}>
            {selectedFiles.map((file, index) => (
              <ListItem key={index} dense sx={{ px: 1 }}>
                <ListItemText
                  primary={
                    <Typography fontFamily="MadeTommy" fontSize={11} noWrap>
                      {file.name}
                    </Typography>
                  }
                  secondary={
                    <Typography fontFamily="MadeTommy" fontSize={9} color="text.secondary">
                      {(file.size / 1024).toFixed(1)} KB
                    </Typography>
                  }
                />
                {!uploading && (
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const newFiles = [...selectedFiles];
                        newFiles.splice(index, 1);
                        setSelectedFiles(newFiles);
                        if (newFiles.length === 0) {
                          setShowSelectedFiles(false);
                        }
                      }}
                      sx={{ 
                        color: "#666",
                        "& .MuiSvgIcon-root": {
                          fontSize: "14px",
                        }
                      }}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                )}
              </ListItem>
            ))}
          </List>
          
          {/* Upload Progress */}
          {uploading && (
            <Box sx={{ mt: 2, mb: 1 }}>
              <Typography fontFamily="MadeTommy" fontSize={9} color="text.secondary" textAlign="center" mb={0.5}>
                {uploadStatus.success + uploadStatus.failed} of {selectedFiles.length} files processed
              </Typography>
              <Box sx={{ width: '100%', bgcolor: '#E9ECEF', borderRadius: 1, height: 6, overflow: 'hidden' }}>
                <Box 
                  sx={{ 
                    width: `${((uploadStatus.success + uploadStatus.failed) / selectedFiles.length) * 100}%`, 
                    bgcolor: uploadStatus.failed > 0 ? '#ff4444' : '#4CAF50',
                    height: '100%',
                    transition: 'width 0.3s ease'
                  }} 
                />
              </Box>
            </Box>
          )}
          
          {/* Upload Controls */}
          <Box display="flex" gap={1} mt={2}>
            <Button
              fullWidth
              variant="outlined"
              size="small"
              onClick={handleCancelUpload}
              disabled={uploading}
              sx={{
                fontSize: "11px",
                fontFamily: "MadeTommy",
                textTransform: "none",
                color: uploading ? "#999" : "#666",
                borderColor: uploading ? "#eee" : "#ddd",
                fontWeight: "normal",
                letterSpacing: "normal",
                minHeight: "32px",
                "&:hover": {
                  borderColor: uploading ? "#eee" : "#bbb",
                  backgroundColor: uploading ? "transparent" : "#f5f5f5",
                },
                "&:disabled": {
                  color: "#999",
                  borderColor: "#eee",
                },
              }}
            >
              {uploading ? "Processing..." : "Cancel"}
            </Button>
            
            <Button
              fullWidth
              size="small"
              onClick={handleUpload}
              disabled={uploading || selectedFiles.length === 0}
              sx={{
                fontSize: "11px",
                fontFamily: "MadeTommy",
                textTransform: "none",
                color: uploading ? "#999" : "#2A2A2A",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                backgroundColor: uploading ? "#f0f0f0" : "#D9FFEA",
                fontWeight: "normal",
                letterSpacing: "normal",
                minHeight: "32px",
                "&:hover": {
                  backgroundColor: uploading ? "#f0f0f0" : "#C9EFDA",
                },
                "&:disabled": {
                  backgroundColor: "#f0f0f0",
                  color: "#999",
                },
              }}
            >
              {uploading ? (
                <>
                  <CircularProgress size={14} sx={{ color: "#2A2A2A" }} />
                  {`${uploadStatus.success + uploadStatus.failed}/${selectedFiles.length}`}
                </>
              ) : (
                `Upload ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}`
              )}
            </Button>
          </Box>
          
          {/* Upload Status Messages */}
          {!uploading && uploadStatus.success > 0 && (
            <Typography 
              fontFamily="MadeTommy" 
              fontSize={10} 
              color="success.main" 
              textAlign="center"
              mt={1}
            >
              ✓ {uploadStatus.currentFile || `Uploaded ${uploadStatus.success} file(s) successfully`}
            </Typography>
          )}
          
          {/* Error Messages */}
          {uploadStatus.errorMessage && (
            <Typography 
              fontFamily="MadeTommy" 
              fontSize={9} 
              color="error.main" 
              textAlign="center"
              mt={1}
              sx={{ fontStyle: 'italic', wordBreak: 'break-word' }}
            >
              ⚠ {uploadStatus.errorMessage}
            </Typography>
          )}
          
          {!uploading && uploadStatus.failed > 0 && !uploadStatus.errorMessage && (
            <Typography 
              fontFamily="MadeTommy" 
              fontSize={10} 
              color="error.main" 
              textAlign="center"
              mt={1}
            >
              ✗ {uploadStatus.failed} file(s) failed to upload
            </Typography>
          )}
        </Box>
      )}

      {/* Search */}
      <TextField
        placeholder="Search PDFs"
        variant="filled"
        size="small"
        value={searchTerm}
        onChange={(e) => {
          e.stopPropagation();
          setSearchTerm(e.target.value);
        }}
        onClick={(e) => e.stopPropagation()}
        sx={{
          borderRadius: 2,
          overflow: "hidden",
          "& .MuiFilledInput-root": {
            padding: "10px",
            backgroundColor: "#E9ECEF",
            borderRadius: "inherit",
            fontFamily: "MadeTommy",
            "&:before": { borderBottom: "none" },
            "&:after": { borderBottom: "none" },
            "&:hover:before": { borderBottom: "none" },
          },
          "& .MuiInputBase-input": {
            fontSize: "12px",
            padding: 0,
            fontFamily: "MadeTommy",
          },
        }}
      />

      {/* File List */}
      <Box sx={{ flex: 1, overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        {filteredFiles.length === 0 ? (
          <Typography 
            fontFamily="MadeTommy" 
            fontSize={12} 
            color="text.secondary" 
            textAlign="center"
            sx={{ mt: 4 }}
          >
            {searchTerm ? "No files match your search" : "No PDFs uploaded yet"}
          </Typography>
        ) : (
          filteredFiles.map((file) => (
            <Box
              key={file.id}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              mb={1}
              sx={{
                cursor: "pointer",
                padding: "8px 12px",
                borderRadius: 1,
                "&:hover": {
                  backgroundColor: "#f5f5f5",
                },
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handlePDFClick(file);
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography fontFamily="MadeTommy" fontSize={13} noWrap>
                  {file.name}
                </Typography>
                {file.chunks > 0 && (
                  <Typography fontFamily="MadeTommy" fontSize={9} color="text.secondary">
                    {file.chunks} chunks
                  </Typography>
                )}
              </Box>

              <IconButton
                size="small"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!window.confirm(`Are you sure you want to delete "${file.name}"?`)) return;
                  handleDelete(file.id, e);
                }}
                sx={{
                  color: "#999",
                  backgroundColor: "transparent",
                  fontSize: "12px",
                  "&:hover": { 
                    backgroundColor: "transparent",
                    color: "#ff4444",
                  },
                }}
              >
                ✕
              </IconButton>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}