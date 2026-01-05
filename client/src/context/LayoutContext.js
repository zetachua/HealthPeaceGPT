import React, { createContext, useState, useContext, useEffect } from 'react';
import { API_BASE_URL } from '../components/Chatbot';
const LayoutContext = createContext();

export const useLayout = () => useContext(LayoutContext);

export const LayoutProvider = ({ children }) => {
  const [isPDFOpen, setIsPDFOpen] = useState(false);
  const [selectedPDF, setSelectedPDF] = useState(null);
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(true);

  // Fetch files function
  const fetchFiles = async () => {
    try {
      setLoadingFiles(true);
      const res = await fetch(`${API_BASE_URL}/files`);
      const data = await res.json();
      setFiles(data);
    } catch (error) {
      console.error("Failed to fetch files:", error);
    } finally {
      setLoadingFiles(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchFiles();
  }, []);

  const openPDF = (pdf) => {
    setSelectedPDF(pdf);
    setIsPDFOpen(true);
  };

  const closePDF = () => {
    setIsPDFOpen(false);
    setSelectedPDF(null);
  };

  // Add function to refresh files (call this after upload)
  const refreshFiles = () => {
    fetchFiles();
  };

  return (
    <LayoutContext.Provider
      value={{
        isPDFOpen,
        selectedPDF,
        openPDF,
        closePDF,
        files,
        loadingFiles,
        refreshFiles,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
};
