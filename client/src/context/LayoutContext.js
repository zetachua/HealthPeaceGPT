import React, { createContext, useState, useContext, useEffect } from 'react';
import { API_BASE_URL } from '../components/Chatbot';
const LayoutContext = createContext();

export const useLayout = () => useContext(LayoutContext);

export const LayoutProvider = ({ children }) => {
  const [isPDFOpen, setIsPDFOpen] = useState(false);
  const [selectedPDF, setSelectedPDF] = useState(null);
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(true);

  // Fetch files function with sorting
  const fetchFiles = async (sortBy = "name", order = "asc") => {
    try {
      setLoadingFiles(true);
      const res = await fetch(`${API_BASE_URL}/files?sortBy=${sortBy}&order=${order}`);
      const data = await res.json();
      setFiles(data);
    } catch (error) {
      console.error("Failed to fetch files:", error);
    } finally {
      setLoadingFiles(false);
    }
  };

  // Initial fetch with default sorting
  useEffect(() => {
    fetchFiles("name", "asc");
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
  const refreshFiles = (sortBy = "name", order = "asc") => {
    fetchFiles(sortBy, order);
  };

  return (
    <LayoutContext.Provider
      value={{
        isPDFOpen,
        selectedPDF,
        openPDF,
        closePDF,
        files,
        setFiles,
        loadingFiles,
        refreshFiles,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
};
