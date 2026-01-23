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
  Snackbar,
  Alert,
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
    currentFileIndex: 0,
    totalFiles: 0,
    progress: 0,
    stage: '',
    currentPage: 0,      // ✅ Add this
    totalPages: 0,       // ✅ Add this
    pageProgress: 0,     // ✅ Add this
    errorMessage: ""
  });
  const [duplicateFiles, setDuplicateFiles] = useState([]);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "info"
  });
  const [sortBy, setSortBy] = useState("name"); // "name" or "date"
  const [sortOrder, setSortOrder] = useState("asc"); // "asc" or "desc"

  // Create a map of existing files for duplicate checking
  const existingFilesMap = useRef(new Map());
  
  // Update the map whenever files change
  useEffect(() => {
    existingFilesMap.current.clear();
    files.forEach(file => {
      // Use name as the identifier (since we don't have size in database)
      const key = file.name.toLowerCase(); // Use lowercase for case-insensitive comparison
      existingFilesMap.current.set(key, true);
    });
    console.log("Existing files map updated:", Array.from(existingFilesMap.current.keys()));
  }, [files]);

  // 🔥 FIX #11: Fetch files with sorting when sort changes
  // Note: Initial fetch is handled by LayoutContext, this only handles sort changes
  const prevSortRef = useRef({ sortBy: "name", sortOrder: "asc" });
  useEffect(() => {
    // Only refetch if sort actually changed (not on initial mount)
    if (prevSortRef.current.sortBy !== sortBy || prevSortRef.current.sortOrder !== sortOrder) {
      prevSortRef.current = { sortBy, sortOrder };
      refreshFiles(sortBy, sortOrder);
    }
  }, [sortBy, sortOrder]);

  // Keep upload section open when uploading
  useEffect(() => {
    if (uploading && selectedFiles.length > 0) {
      setShowSelectedFiles(true);
    }
  }, [uploading, selectedFiles.length]);

  // Check for duplicates when files are selected
  const checkForDuplicates = (newFiles) => {
    const duplicates = [];
    const uniqueNewFiles = [];
    
    console.log("Checking for duplicates. Existing files:", Array.from(existingFilesMap.current.keys()));
    
    newFiles.forEach(file => {
      // Use lowercase name for comparison
      const key = file.name.toLowerCase();
      console.log(`Checking file: ${file.name} (key: ${key})`);
      
      if (existingFilesMap.current.has(key)) {
        console.log(`Duplicate found: ${file.name}`);
        duplicates.push({
          name: file.name,
          size: file.size,
          key: key
        });
      } else {
        console.log(`Unique file: ${file.name}`);
        uniqueNewFiles.push(file);
      }
    });
    
    console.log(`Found ${duplicates.length} duplicates, ${uniqueNewFiles.length} unique files`);
    return { duplicates, uniqueNewFiles };
  };

  // Handle file selection (multiple files)
  const handleFileSelect = (event) => {
    const selected = Array.from(event.target.files);
    console.log("Files selected:", selected.map(f => f.name));
    
    if (selected.length > 0) {
      // Check for duplicates
      const { duplicates, uniqueNewFiles } = checkForDuplicates(selected);
      
      if (duplicates.length > 0) {
        setDuplicateFiles(duplicates);
        setSnackbar({
          open: true,
          message: `${duplicates.length} file(s) already exist and won't be uploaded.`,
          severity: "warning"
        });
        
        // Only upload unique files
        if (uniqueNewFiles.length > 0) {
          setSelectedFiles(uniqueNewFiles);
          setShowSelectedFiles(true);
          setUploadStatus({ success: 0, failed: 0, currentFile: "", errorMessage: "" });
          console.log(`Setting ${uniqueNewFiles.length} unique files for upload`);
        } else {
          // All files are duplicates
          setSelectedFiles([]);
          setShowSelectedFiles(false);
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
          console.log("All selected files are duplicates");
          return;
        }
      } else {
        // No duplicates found
        setDuplicateFiles([]);
        setSelectedFiles(selected);
        setShowSelectedFiles(true);
        setUploadStatus({ success: 0, failed: 0, currentFile: "", errorMessage: "" });
        console.log("No duplicates found, all files are unique");
      }
    }
  };

  // Test server connection
  // const testServerConnection = async () => {
  //   try {
  //     console.log(`Testing connection to: ${API_BASE_URL}`);
  //     const response = await fetch(`${API_BASE_URL}/`, {
  //       method: "GET",
  //       headers: {
  //         "Accept": "application/json",
  //       },
  //     });
  //     console.log("Server connection test:", response.status, response.statusText);
  //     return response.ok;
  //   } catch (error) {
  //     console.error("Server connection failed:", error);
  //     return false;
  //   }
  // };

// Upload multiple files with real-time progress

const handleUpload = async (e) => {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  if (selectedFiles.length === 0) return;

  setUploading(true);
  if (setIsUploading) {
    setIsUploading(true);
  }

  const filesToUpload = [...selectedFiles];
  let successfulUploads = 0;
  let failedUploads = 0;

  try {
    // Upload files sequentially with progress
    for (let fileIndex = 0; fileIndex < filesToUpload.length; fileIndex++) {
      const file = filesToUpload[fileIndex];
      
      // Reset status for new file
      setUploadStatus({ 
        success: successfulUploads, 
        failed: failedUploads,
        currentFile: `Starting: ${file.name}`,
        currentFileIndex: fileIndex + 1,
        totalFiles: filesToUpload.length,
        progress: 0,
        stage: 'start',
        currentPage: 0,
        totalPages: 0,
        pageProgress: 0,
        chunksProcessed: 0,
        totalChunks: 0,
        errorMessage: ""
      });

      try {
        const formData = new FormData();
        formData.append("file", file);

        console.log(`Starting upload for: ${file.name}`);

        // 1. Start the upload and get uploadId
        const startResponse = await fetch(`${API_BASE_URL}/upload-and-ingest-stream`, {
          method: "POST",
          body: formData
        });

        if (!startResponse.ok) {
          throw new Error(`Upload start failed: ${startResponse.status}`);
        }

        const { uploadId } = await startResponse.json();
        console.log(`Upload started with ID: ${uploadId}`);

        // 2. Connect to SSE progress stream
        const eventSource = new EventSource(
          `${API_BASE_URL}/upload-progress/${uploadId}`
        );

        // 3. Listen for progress updates
        await new Promise((resolve, reject) => {
          let lastProgress = 0;
          const timeout = setTimeout(() => {
            eventSource.close();
            reject(new Error("Upload timeout - no progress for 60 seconds"));
          }, 60000); // 60 second timeout

          eventSource.onmessage = (event) => {
            try {
              clearTimeout(timeout); // Reset timeout on each message
              
              const data = JSON.parse(event.data);
              console.log("Progress update:", data);
              
              // Update UI with progress
              setUploadStatus(prev => ({
                ...prev,
                currentFile: data.message || prev.currentFile,
                progress: data.progress || prev.progress,
                stage: data.stage,
                currentPage: data.currentPage || 0,
                totalPages: data.totalPages || 0,
                pageProgress: data.pageProgress || 0,
                chunksProcessed: data.chunksProcessed || 0,
                totalChunks: data.totalChunks || 0,
                currentFileIndex: fileIndex + 1,
                totalFiles: filesToUpload.length
              }));
              
              lastProgress = data.progress || lastProgress;
              
              // Check for completion
              if (data.stage === 'complete') {
                console.log("Upload complete:", data.result);
                eventSource.close();
                clearTimeout(timeout);
                resolve(data.result);
              }
              
              // Check for errors
              if (data.stage === 'error') {
                console.error("Upload error:", data.error);
                eventSource.close();
                clearTimeout(timeout);
                reject(new Error(data.error || "Upload failed"));
              }
            } catch (parseError) {
              console.error("Failed to parse SSE data:", parseError);
            }
          };

          eventSource.onerror = (error) => {
            console.error("SSE connection error:", error);
            eventSource.close();
            clearTimeout(timeout);
            
            // Only reject if we haven't made any progress (likely a connection issue)
            if (lastProgress === 0) {
              reject(new Error("Failed to connect to upload progress stream"));
            } else {
              // If we were making progress, the upload might still complete
              // Wait a bit and then check if we got to 100%
              setTimeout(() => {
                if (lastProgress < 100) {
                  reject(new Error("Connection lost during upload"));
                } else {
                  resolve({ partial: true });
                }
              }, 2000);
            }
          };

          // Cleanup on unmount or component update
          return () => {
            eventSource.close();
            clearTimeout(timeout);
          };
        });

        successfulUploads++;
        
        // Add to existing files map
        const key = file.name.toLowerCase();
        existingFilesMap.current.set(key, true);

        console.log(`✓ Upload successful for: ${file.name}`);

      } catch (uploadError) {
        console.error(`Upload failed for ${file.name}:`, uploadError);
        failedUploads++;
        
        setUploadStatus(prev => ({
          ...prev,
          errorMessage: uploadError.message,
          failed: failedUploads
        }));

        // Show error for a moment before continuing
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Small delay between files
      if (fileIndex < filesToUpload.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Final status update
    setUploadStatus({ 
      success: successfulUploads, 
      failed: failedUploads,
      currentFile: successfulUploads > 0 
        ? `Uploaded ${successfulUploads} file(s) successfully!` 
        : "All uploads failed",
      currentFileIndex: filesToUpload.length,
      totalFiles: filesToUpload.length,
      progress: 100,
      stage: 'complete',
      errorMessage: failedUploads > 0 ? `${failedUploads} file(s) failed` : ""
    });

    // Refresh files list
    if (successfulUploads > 0) {
      console.log("Refreshing files list...");
      await refreshFiles(sortBy, sortOrder);
      
      setSnackbar({
        open: true,
        message: `Successfully uploaded ${successfulUploads} file(s)${failedUploads > 0 ? ` (${failedUploads} failed)` : ''}`,
        severity: successfulUploads > 0 ? "success" : "error"
      });

      // Close upload section on mobile after success
      if (onMobileUploadComplete) {
        setTimeout(onMobileUploadComplete, 2000);
      }

      // Clear selection after a moment
      setTimeout(() => {
        setSelectedFiles([]);
        setDuplicateFiles([]);
        setShowSelectedFiles(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }, 1500);
    } else {
      setSnackbar({
        open: true,
        message: "All uploads failed. Please try again.",
        severity: "error"
      });
    }

  } catch (err) {
    console.error("Upload process error:", err);
    setUploadStatus({ 
      success: 0, 
      failed: filesToUpload.length,
      currentFile: "Upload process failed",
      progress: 0,
      errorMessage: err.message
    });
    
    setSnackbar({
      open: true,
      message: `Upload failed: ${err.message}`,
      severity: "error"
    });
  } finally {
    // Always clean up after a delay
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
      setDuplicateFiles([]);
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
    const fileToDelete = files.find(f => f.id === id);
    setFiles(prev => prev.filter(f => f.id !== id));
    
    // Remove from existing files map
    if (fileToDelete) {
      const key = fileToDelete.name.toLowerCase();
      existingFilesMap.current.delete(key);
    }
  
    try {
      const response = await fetch(`${API_BASE_URL}/delete/${id}`, {
        method: "DELETE",
      });
  
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
  
      // Refresh files from server just in case
      await refreshFiles(sortBy, sortOrder);
      
      // Show snackbar
      setSnackbar({
        open: true,
        message: `"${fileToDelete?.name || 'File'}" deleted successfully`,
        severity: "info"
      });
    } catch (error) {
      console.error("Delete failed:", error);
  
      // Rollback if delete fails
      setFiles(originalFiles);
      if (fileToDelete) {
        const key = fileToDelete.name.toLowerCase();
        existingFilesMap.current.set(key, true);
      }
      
      setSnackbar({
        open: true,
        message: "Failed to delete file. Please try again.",
        severity: "error"
      });
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

      {/* Duplicate Files Warning */}
      {duplicateFiles.length > 0 && (
        <Box sx={{ 
          border: "1px solid #FFA726", 
          borderRadius: 1, 
          p: 1.5,
          backgroundColor: "#FFF3E0",
          mt: 1
        }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography fontFamily="MadeTommy" fontSize={10} color="#E65100">
              ⚠ {duplicateFiles.length} duplicate file(s) detected:
            </Typography>
            <IconButton
              size="small"
              onClick={() => setDuplicateFiles([])}
              sx={{ 
                padding: 0, 
                color: "#E65100",
                "& .MuiSvgIcon-root": {
                  fontSize: "14px",
                }
              }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
          <List dense sx={{ maxHeight: "80px", overflow: "auto", bgcolor: "white", borderRadius: 0.5 }}>
            {duplicateFiles.map((dup, index) => (
              <ListItem key={index} dense sx={{ px: 1, py: 0.5 }}>
                <ListItemText
                  primary={
                    <Typography fontFamily="MadeTommy" fontSize={9} noWrap>
                      {dup.name}
                    </Typography>
                  }
                  secondary={
                    <Typography fontFamily="MadeTommy" fontSize={8} color="text.secondary">
                      {(dup.size / 1024).toFixed(1)} KB
                    </Typography>
                  }
                />
              </ListItem>
            ))}
          </List>
          <Typography fontFamily="MadeTommy" fontSize={9} color="#E65100" mt={1}>
            These files already exist and won't be uploaded.
          </Typography>
        </Box>
      )}

      {/* Selected Files List */}
      {(showSelectedFiles || selectedFiles.length > 0) && (
        <Box sx={{ mt: 1, border: "1px solid #E9ECEF", borderRadius: 1, p: 1.5 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography fontFamily="MadeTommy" fontSize={11} color="text.secondary">
              {uploading 
                ? `Uploading and Embedding Data...` 
                : `${selectedFiles.length} file(s) selected`}
              {duplicateFiles.length > 0 && ` (+${duplicateFiles.length} duplicates skipped)`}
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
          
      
            {/* Upload Progress - Enhanced with Page Info */}
            {uploading && (
              <Box sx={{ mt: 2, mb: 1 }}>
                {/* File counter */}
                {uploadStatus.currentFileIndex && (
                  <Typography fontFamily="MadeTommy" fontSize={9} color="text.secondary" textAlign="center" mb={0.5}>
                    File {uploadStatus.currentFileIndex} of {uploadStatus.totalFiles}
                  </Typography>
                )}
                
                {/* Page progress (if OCR stage) */}
                {uploadStatus.stage === 'ocr' && uploadStatus.totalPages > 0 && (
                  <Box sx={{ mb: 1 , mt:1}}>
                    <Typography fontFamily="MadeTommy" fontSize={9} color="text.secondary" textAlign="center" mb={0.5}>
                      Page {uploadStatus.currentPage || 0} of {uploadStatus.totalPages}: {Math.round(uploadStatus.pageProgress || 0)}%
                    </Typography>
                    
                    {/* Per-page progress bar */}
                    <Box sx={{ width: '100%', bgcolor: '#FFF3E0', borderRadius: 1, height: 6, overflow: 'hidden', mb: 0.5 }}>
                      <Box 
                        sx={{ 
                          width: `${uploadStatus.pageProgress || 0}%`, 
                          bgcolor: '#FF9800',
                          height: '100%',
                          transition: 'width 0.2s ease'
                        }} 
                      />
                    </Box>
                  </Box>
                )}
                
                {/* Chunk progress (if embedding) */}
                {uploadStatus.stage === 'embedding' && uploadStatus.totalChunks && (
                  <Typography fontFamily="MadeTommy" fontSize={8} color="text.secondary" textAlign="center" mb={0.5}>
                    Processing chunks: {uploadStatus.chunksProcessed || 0}/{uploadStatus.totalChunks}
                  </Typography>
                )}
                
                {/* Overall progress bar */}
                <Box sx={{ width: '100%', bgcolor: '#E9ECEF', borderRadius: 1, height: 8, overflow: 'hidden', mb: 0.5 }}>
                  <Box 
                    sx={{ 
                      width: `${uploadStatus.progress || 0}%`, 
                      bgcolor: uploadStatus.stage === 'ocr' ? '#4CAF50' : '#2196F3',
                      height: '100%',
                      transition: 'width 0.3s ease'
                    }} 
                  />
                </Box>
                
                {/* Overall percentage */}
                <Typography fontFamily="MadeTommy" fontSize={9} color="text.secondary" textAlign="center">
                  Overall: {Math.round(uploadStatus.progress || 0)}%
                </Typography>
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

      {/* 🔥 FIX #11: Sorting Controls */}
      <Box display="flex" gap={1} alignItems="center">
        <Typography fontFamily="MadeTommy" fontSize={10} color="text.secondary">
          Sort:
        </Typography>
        <Button
          size="small"
          onClick={() => {
            const newSortBy = sortBy === "name" ? "date" : "name";
            setSortBy(newSortBy);
          }}
          sx={{
            fontSize: "10px",
            fontFamily: "MadeTommy",
            textTransform: "none",
            color: "#2A2A2A",
            backgroundColor: sortBy === "name" ? "#D9FFEA" : "#E9ECEF",
            minWidth: "60px",
            "&:hover": {
              backgroundColor: sortBy === "name" ? "#C9EFDA" : "#D9D9D9",
            },
          }}
        >
          {sortBy === "name" ? "Name" : "Date"}
        </Button>
        <Button
          size="small"
          onClick={() => {
            setSortOrder(sortOrder === "asc" ? "desc" : "asc");
          }}
          sx={{
            fontSize: "10px",
            fontFamily: "MadeTommy",
            textTransform: "none",
            color: "#2A2A2A",
            backgroundColor: sortOrder === "asc" ? "#D9FFEA" : "#E9ECEF",
            minWidth: "50px",
            "&:hover": {
              backgroundColor: sortOrder === "asc" ? "#C9EFDA" : "#D9D9D9",
            },
          }}
        >
          {sortOrder === "asc" ? "↑" : "↓"}
        </Button>
      </Box>

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

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert 
          onClose={() => setSnackbar({ ...snackbar, open: false })} 
          severity={snackbar.severity}
          sx={{ 
            fontFamily: "MadeTommy", 
            fontSize: "11px",
            alignItems: "center"
          }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
