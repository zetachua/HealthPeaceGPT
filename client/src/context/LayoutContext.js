import React, { createContext, useState, useContext } from 'react';

const LayoutContext = createContext();

export const useLayout = () => useContext(LayoutContext);

export const LayoutProvider = ({ children }) => {
  const [isPDFOpen, setIsPDFOpen] = useState(false);
  const [selectedPDF, setSelectedPDF] = useState(null); // {id, name}

  const openPDF = (pdf) => {
    setSelectedPDF(pdf);
    setIsPDFOpen(true);
  };

  const closePDF = () => {
    setIsPDFOpen(false);
    setSelectedPDF(null);
  };

  return (
    <LayoutContext.Provider
      value={{
        isPDFOpen,
        selectedPDF,
        openPDF,
        closePDF,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
};
