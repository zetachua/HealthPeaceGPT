import {
  Box,
  Typography,
  Button,
  TextField,
  CircularProgress,
} from "@mui/material";
import { FileUpload } from "@mui/icons-material";
import { useEffect, useState, useRef } from "react";

export default function SideBar({ textColor }) {
  const fileInputRef = useRef(null);

  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [uploading, setUploading] = useState(false);

  // Fetch files on load
  const fetchFiles = async () => {
    const res = await fetch("http://localhost:5001/files");
    const data = await res.json();
    setFiles(data);
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  // Upload file
  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const response = await fetch("http://localhost:5001/upload", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const newFile = await response.json();

        setFiles((prev) => [...prev, newFile]);
        setSelectedFile(null);

        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setUploading(false);
    }
  };

  // Delete file
  const handleDelete = async (id) => {
    await fetch(`http://localhost:5001/delete/${id}`, {
      method: "DELETE",
    });

    setFiles((prev) => prev.filter((file) => file.id !== id));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setSelectedFile(null);
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

        {/* Upload Button */}
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
            onChange={(e) => setSelectedFile(e.target.files[0])}
            ref={fileInputRef}
          />
        </Button>
      </Box>

      {/* Confirm Upload */}
      {selectedFile && (
        <Button
          size="small"
          onClick={handleUpload}
          disabled={uploading}
          sx={{
            color: "#2A2A2A",
            textTransform: "none",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          {uploading && <CircularProgress size={16} />}
          {uploading ? "Uploading & Embedding..." : "Confirm Upload"}
        </Button>
      )}

      {/* Search */}
      <TextField
        placeholder="Search"
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

      {/* File List (no background, no borders) */}
      <Box sx={{ height: 250, overflowY: "auto" }}>
        {filteredFiles.map((file) => (
          <Box
            key={file.id}
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            mb={1}
          >
            <Typography fontFamily="MadeTommy" fontSize={13}>
              {file.name}
            </Typography>

            <Button
              disableRipple
              disableElevation
              onClick={() => handleDelete(file.id)}
              sx={{
                minWidth: "auto",
                padding: 0,
                color: "#2A2A2A",
                backgroundColor: "transparent",
                "&:hover": { backgroundColor: "transparent" },
                "&:active": { backgroundColor: "transparent" },
              }}
            >
              ✕
            </Button>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
