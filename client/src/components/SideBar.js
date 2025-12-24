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
import { FileUpload, Delete as DeleteIcon } from "@mui/icons-material";
import { useEffect, useState, useRef } from "react";
import { useLayout } from "../context/LayoutContext";

export default function SideBar({ textColor }) {
  const fileInputRef = useRef(null);
  const { openPDF } = useLayout();

  const [files, setFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]); // Changed to array
  const [searchTerm, setSearchTerm] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({}); // Track progress per file

  // Fetch files on load
  const fetchFiles = async () => {
    const res = await fetch("http://localhost:5001/files");
    const data = await res.json();
    setFiles(data);
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  // Handle file selection (multiple files)
  const handleFileSelect = (event) => {
    const selected = Array.from(event.target.files);
    setSelectedFiles(selected);
  };

  // Upload multiple files
  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    const uploadedFiles = [];

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      
      // Update progress
      setUploadProgress(prev => ({
        ...prev,
        [file.name]: { progress: 0, status: 'uploading' }
      }));

      const formData = new FormData();
      formData.append("file", file);

      try {
        // Simulate progress (optional - for visual feedback)
        const simulateProgress = setInterval(() => {
          setUploadProgress(prev => ({
            ...prev,
            [file.name]: { 
              ...prev[file.name], 
              progress: Math.min((prev[file.name]?.progress || 0) + 10, 90) 
            }
          }));
        }, 300);

        const response = await fetch("http://localhost:5001/upload", {
          method: "POST",
          body: formData,
        });

        clearInterval(simulateProgress);

        if (response.ok) {
          const newFile = await response.json();
          uploadedFiles.push(newFile);
          
          // Update progress to completed
          setUploadProgress(prev => ({
            ...prev,
            [file.name]: { progress: 100, status: 'completed' }
          }));
        } else {
          setUploadProgress(prev => ({
            ...prev,
            [file.name]: { progress: 0, status: 'error', error: 'Upload failed' }
          }));
        }
      } catch (err) {
        console.error("Upload error for", file.name, ":", err);
        setUploadProgress(prev => ({
          ...prev,
          [file.name]: { progress: 0, status: 'error', error: err.message }
        }));
      }
    }

    // Update files list with all uploaded files
    if (uploadedFiles.length > 0) {
      setFiles(prev => [...prev, ...uploadedFiles]);
    }

    // Clear selected files and reset input
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setUploading(false);
    // Clear progress after a delay
    setTimeout(() => {
      setUploadProgress({});
    }, 3000);
  };

  // Delete file
  const handleDelete = async (id, e) => {
    e.stopPropagation();
    await fetch(`http://localhost:5001/delete/${id}`, {
      method: "DELETE",
    });

    setFiles((prev) => prev.filter((file) => file.id !== id));
  };

  // Handle PDF click
  const handlePDFClick = (file) => {
    openPDF(file);
  };

  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(searchTerm.toLowerCase())
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

        {/* Upload Button - Now supports multiple */}
        <Button
          component="label"
          size="small"
          startIcon={<FileUpload />}
          sx={{
            fontSize: 12,
            py: 0.5,
            backgroundColor: "#D9FFEA",
            color: "#2A2A2A",
            textTransform: "none",
            "&:hover": {
              backgroundColor: "#D9FFEA",
            },
          }}
        >
          Upload
          <input
            type="file"
            hidden
            accept=".pdf"
            onChange={handleFileSelect}
            ref={fileInputRef}
            multiple // Add this for multiple file selection
          />
        </Button>
      </Box>

      {/* Selected Files List */}
      {selectedFiles.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography fontFamily="MadeTommy" fontSize={11} color="text.secondary" mb={1}>
            Selected files ({selectedFiles.length}):
          </Typography>
          <List dense sx={{ maxHeight: "150px", overflow: "auto", bgcolor: "#f9f9f9", borderRadius: 1 }}>
            {selectedFiles.map((file, index) => (
              <ListItem key={index} dense>
                <ListItemText
                  primary={
                    <Typography fontFamily="MadeTommy" fontSize={11}>
                      {file.name}
                    </Typography>
                  }
                  secondary={
                    uploadProgress[file.name] && (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
                        <CircularProgress 
                          size={12} 
                          variant={uploadProgress[file.name].status === 'completed' ? "determinate" : "indeterminate"}
                          value={uploadProgress[file.name].progress}
                        />
                        <Typography fontFamily="MadeTommy" fontSize={9}>
                          {uploadProgress[file.name].status === 'completed' 
                            ? 'Uploaded' 
                            : uploadProgress[file.name].status === 'error'
                            ? 'Failed'
                            : 'Uploading...'}
                        </Typography>
                      </Box>
                    )
                  }
                />
                <ListItemSecondaryAction>
                  <IconButton
                    edge="end"
                    size="small"
                    onClick={() => {
                      const newFiles = [...selectedFiles];
                      newFiles.splice(index, 1);
                      setSelectedFiles(newFiles);
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
          
          {/* Upload Button for multiple files */}
          <Button
            fullWidth
            size="small"
            onClick={handleUpload}
            disabled={uploading || selectedFiles.length === 0}
            sx={{
              mt: 1,
              color: "#2A2A2A",
              textTransform: "none",
              display: "flex",
              alignItems: "center",
              gap: 1,
              backgroundColor: "#D9FFEA",
              "&:hover": {
                backgroundColor: "#D9FFEA",
              },
              "&:disabled": {
                backgroundColor: "#f0f0f0",
              },
            }}
          >
            {uploading && <CircularProgress size={16} />}
            {uploading 
              ? `Uploading ${selectedFiles.length} files...` 
              : `Upload ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}`}
          </Button>
        </Box>
      )}

      {/* Search */}
      <TextField
        placeholder="Search PDFs"
        variant="filled"
        size="small"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        sx={{
          borderRadius: 2,
          overflow: "hidden",
          "& .MuiFilledInput-root": {
            padding: "10px",
            backgroundColor: "#E9ECEF",
            borderRadius: "inherit",
            "&:before": { borderBottom: "none" },
            "&:after": { borderBottom: "none" },
            "&:hover:before": { borderBottom: "none" },
          },
          "& .MuiInputBase-input": {
            fontSize: "12px",
            padding: 0,
          },
        }}
      />

      {/* File List */}
      <Box sx={{ flex: 1, overflowY: "auto" }}>
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
              onClick={() => handlePDFClick(file)}
            >
              <Box>
                <Typography fontFamily="MadeTommy" fontSize={13}>
                  {file.name}
                </Typography>
                {file.chunks > 0 && (
                  <Typography fontFamily="MadeTommy" fontSize={9} color="text.secondary">
                    {file.chunks} chunks
                  </Typography>
                )}
              </Box>

              <Button
                disableRipple
                disableElevation
                onClick={(e) => handleDelete(file.id, e)}
                sx={{
                  minWidth: "auto",
                  padding: 0,
                  color: "#2A2A2A",
                  backgroundColor: "transparent",
                  "&:hover": { 
                    backgroundColor: "transparent",
                    color: "#ff4444",
                  },
                }}
              >
                ✕
              </Button>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
