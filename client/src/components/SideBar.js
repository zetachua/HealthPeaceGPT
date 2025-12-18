import { Box, Typography, Paper, Button, TextField, CircularProgress } from "@mui/material";
import { FileUpload } from '@mui/icons-material';
import { useEffect, useState, useRef } from "react"; // <-- ADDED useRef

export default function SideBar({ textColor }) {
  const fileInputRef = useRef(null); // <-- NEW: Ref to clear the file input
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [uploading, setUploading] = useState(false);

  // Fetch knowledge files from backend (used only on initial load)
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
  
    setUploading(true); // START loading
  
    const formData = new FormData();
    formData.append("file", selectedFile);
  
    try {
      const response = await fetch("http://localhost:5001/upload", {
        method: "POST",
        body: formData,
      });
  
      if (response.ok) {
        const newFile = await response.json(); 
        
        setFiles(prevFiles => [...prevFiles, { 
          id: newFile.id, 
          name: newFile.name 
        }]);
  
        setSelectedFile(null);
  
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
  
        // Optional: show a short success feedback
        console.log("File uploaded and embedded successfully.");
      } else {
        console.error("Upload failed on server side, Status:", response.status);
        setSelectedFile(null);
      }
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setUploading(false); // STOP loading
    }
  };
  

  // Delete file
  const handleDelete = async (id) => {
    await fetch(`http://localhost:5001/delete/${id}`, {
      method: "DELETE",
    });
    
    // Update state by filtering out the deleted file
    setFiles(prevFiles => prevFiles.filter(file => file.id !== id));
    
    // --- FIX FOR RE-UPLOAD ISSUE ---
    // If the user deletes a file, we reset the file input element
    if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
    // Also clear selectedFile state just in case
    setSelectedFile(null); 
  };

  // Search file
  const filteredFiles = files.filter(file =>
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
      {/* Knowledge Files HEADING, COUNT, & UPLOAD BUTTON CONTAINER */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mt={2}>
        
        {/* Container for Heading and Count (Grouped Vertically) */}
        <Box display="flex" flexDirection="column"> 
            
            {/* Knowledge Files Heading */}
            <Typography 
                fontFamily={"MadeTommy"} 
                fontSize={13} 
                opacity={0.7}
                mb={0.1} // Sets a very small margin below the heading
            >
              PDF Database
            </Typography>

            {/* File Count Display */}
            <Typography 
                fontFamily={"MadeTommy"} 
                fontSize={10} 
                color="text.secondary"
                mt={0} // Ensures no top margin pushes it away from the heading
            >
              {files.length} files
            </Typography>
        </Box>

        {/* Upload Button */}
        <Button 
          component="label" 
          size="small" 
          variant="contained"
          startIcon={<FileUpload />} 
          sx={{ 
            fontSize: 12, 
            py: 0.5, 
            backgroundColor: '#AECCE4', // Light Blue Hex Code
            '&:hover': {
              backgroundColor: '#9ABDDC', // Sky Blue on hover
            },
            textTransform: 'none', 
          }} 
        >
          Upload
          <input
            type="file"
            hidden
            accept=".pdf"
            onChange={(e) => setSelectedFile(e.target.files[0])}
            ref={fileInputRef} // <-- ATTACH REF HERE
          />
        </Button>
      </Box>

      {selectedFile && (
            <Button
            size="small"
            onClick={handleUpload}
            sx={{ color: '#9ABDDC', textTransform: 'none', display:'flex', alignItems:'center', gap:1 }}
            disabled={uploading}
            >
            {uploading && <CircularProgress size={16} />}
            {uploading ? "Uploading & Embedding..." : "Confirm Upload"}
            </Button>

        )}


      {/* Search Bar */}
      <TextField
        placeholder="Search"
        variant="filled"
        size="small"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        sx={{
          mt: 0, // Keep it close to the element above
          mb: 0, // Add a small margin below before the heading
          borderRadius: 2, // <-- MATCH: Rounded corners
          overflow: 'hidden',

          '& .MuiFilledInput-root': {
            
            padding: '10px',
            backgroundColor: '#E9ECEF', 
            borderRadius: 'inherit', 

            display: 'flex',
            alignItems: 'center',

            // <-- MATCH: Remove all borders (hover, active, default)
            '&:hover:not(.Mui-disabled):before': {
                borderBottom: 'none !important',
            },
            '&:after': { 
                borderBottom: 'none !important',
            },
            '&:before': { 
                borderBottom: 'none !important',
            },
          },
          
          '& .MuiInputBase-input': {
            fontSize: '12px', // Keep the text size consistent with the prompt box
            padding: 0,
          },
        }}
      />

      <Paper sx={{ height: 250, overflowY: "auto", p: 1 }}>
      {filteredFiles.map((file) => (
          <Box
            key={file.id}
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            mb={1}
          >
            <Typography fontFamily={"MadeTommy"} fontSize={13}>
              {file.name}
            </Typography>
            <Button
              size="small"
              color="error"
              onClick={() => handleDelete(file.id)}
            >
              ✕
            </Button>
          </Box>
        ))}
      </Paper>
    </Box>
  );
}
