import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface NewsItem {
  id: string;
  title: string;
  category: string;
  readTime: number;
  encryptedScore: number;
  publicViews: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedScore?: number;
}

interface ReadingHistory {
  id: string;
  title: string;
  timestamp: number;
  action: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [filteredNews, setFilteredNews] = useState<NewsItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [showFAQ, setShowFAQ] = useState(false);
  const [readingHistory, setReadingHistory] = useState<ReadingHistory[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingNews, setCreatingNews] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newNewsData, setNewNewsData] = useState({ title: "", category: "technology", readTime: "", score: "" });
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  const categories = ["all", "technology", "politics", "entertainment", "sports", "science"];
  const itemsPerPage = 6;

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadNewsData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    filterNews();
  }, [newsList, searchQuery, selectedCategory]);

  const loadNewsData = async () => {
    if (!isConnected) return;
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const newsItems: NewsItem[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          newsItems.push({
            id: businessId,
            title: businessData.name,
            category: getCategoryFromId(businessId),
            readTime: Number(businessData.publicValue1) || 3,
            encryptedScore: 0,
            publicViews: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedScore: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading news data:', e);
        }
      }
      
      setNewsList(newsItems);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load news" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setLoading(false);
    }
  };

  const filterNews = () => {
    let filtered = newsList;
    
    if (searchQuery) {
      filtered = filtered.filter(item => 
        item.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    if (selectedCategory !== "all") {
      filtered = filtered.filter(item => item.category === selectedCategory);
    }
    
    setFilteredNews(filtered);
    setCurrentPage(1);
  };

  const getCategoryFromId = (id: string) => {
    const categories = ["technology", "politics", "entertainment", "sports", "science"];
    const hash = id.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return categories[hash % categories.length];
  };

  const createNews = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingNews(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating news with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const scoreValue = parseInt(newNewsData.score) || 0;
      const businessId = `news-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, scoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newNewsData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newNewsData.readTime) || 3,
        Math.floor(Math.random() * 1000),
        `News: ${newNewsData.category}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction..." });
      await tx.wait();
      
      addToHistory(businessId, newNewsData.title, "created");
      setTransactionStatus({ visible: true, status: "success", message: "News created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadNewsData();
      setShowCreateModal(false);
      setNewNewsData({ title: "", category: "technology", readTime: "", score: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingNews(false); 
    }
  };

  const decryptScore = async (newsId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(newsId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        addToHistory(newsId, businessData.name, "decrypted");
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(newsId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(newsId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      addToHistory(newsId, businessData.name, "decrypted");
      
      await loadNewsData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Score decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        await loadNewsData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const addToHistory = (id: string, title: string, action: string) => {
    const historyItem: ReadingHistory = {
      id,
      title,
      timestamp: Date.now(),
      action
    };
    setReadingHistory(prev => [historyItem, ...prev.slice(0, 9)]);
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const paginatedNews = filteredNews.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filteredNews.length / itemsPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 Private News Feed</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet to Access Private News</h2>
            <p>Your reading preferences are encrypted with FHE technology for complete privacy</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Read news with encrypted preference scoring</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Your data remains private and secure</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your reading preferences</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted news feed...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>🔐 Private News Aggregator</h1>
          <p>FHE-Protected Reading Preferences</p>
        </div>
        
        <div className="header-controls">
          <button className="neon-btn" onClick={checkAvailability}>
            Check FHE Status
          </button>
          <button className="neon-btn" onClick={() => setShowCreateModal(true)}>
            + Submit News
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <div className="main-content">
        <div className="sidebar">
          <div className="search-section">
            <input
              type="text"
              placeholder="🔍 Search news..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="category-filters">
            <h3>Categories</h3>
            {categories.map(category => (
              <button
                key={category}
                className={`category-btn ${selectedCategory === category ? 'active' : ''}`}
                onClick={() => setSelectedCategory(category)}
              >
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </button>
            ))}
          </div>

          <div className="history-section">
            <h3>Recent Activity</h3>
            {readingHistory.slice(0, 5).map((item, index) => (
              <div key={index} className="history-item">
                <span className="action-badge">{item.action}</span>
                <span className="history-title">{item.title}</span>
              </div>
            ))}
            {readingHistory.length === 0 && (
              <p className="no-history">No recent activity</p>
            )}
          </div>

          <button 
            className={`faq-toggle ${showFAQ ? 'active' : ''}`}
            onClick={() => setShowFAQ(!showFAQ)}
          >
            ❓ FHE FAQ
          </button>
        </div>

        <div className="content-area">
          {showFAQ && (
            <div className="faq-panel">
              <h3>FHE News Aggregator FAQ</h3>
              <div className="faq-item">
                <strong>How does FHE protect my privacy?</strong>
                <p>Your reading preferences are encrypted and processed without decryption</p>
              </div>
              <div className="faq-item">
                <strong>What data is encrypted?</strong>
                <p>Personalized scores are fully encrypted using homomorphic encryption</p>
              </div>
              <div className="faq-item">
                <strong>Can my reading history be tracked?</strong>
                <p>No, all preference data remains encrypted and private</p>
              </div>
            </div>
          )}

          <div className="news-grid">
            {paginatedNews.length === 0 ? (
              <div className="no-news">
                <p>No news articles found</p>
                <button className="neon-btn" onClick={() => setShowCreateModal(true)}>
                  Submit First Article
                </button>
              </div>
            ) : (
              paginatedNews.map((news) => (
                <div 
                  key={news.id} 
                  className="news-card"
                  onClick={() => setSelectedNews(news)}
                >
                  <div className="card-header">
                    <span className="category-tag">{news.category}</span>
                    <span className="read-time">{news.readTime} min read</span>
                  </div>
                  <h3 className="news-title">{news.title}</h3>
                  <div className="card-footer">
                    <div className="views">👁️ {news.publicViews} views</div>
                    <div className={`score ${news.isVerified ? 'verified' : 'encrypted'}`}>
                      {news.isVerified ? `Score: ${news.decryptedScore}` : '🔒 Encrypted Score'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(currentPage - 1)}
                className="page-btn"
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(currentPage + 1)}
                className="page-btn"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Submit News Article</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="fhe-notice">
                <strong>FHE 🔐 Protection</strong>
                <p>Personalized score will be encrypted with homomorphic encryption</p>
              </div>

              <div className="form-group">
                <label>Article Title *</label>
                <input
                  type="text"
                  value={newNewsData.title}
                  onChange={(e) => setNewNewsData({...newNewsData, title: e.target.value})}
                  placeholder="Enter article title..."
                />
              </div>

              <div className="form-group">
                <label>Category *</label>
                <select 
                  value={newNewsData.category}
                  onChange={(e) => setNewNewsData({...newNewsData, category: e.target.value})}
                >
                  {categories.filter(c => c !== 'all').map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Read Time (minutes) *</label>
                <input
                  type="number"
                  value={newNewsData.readTime}
                  onChange={(e) => setNewNewsData({...newNewsData, readTime: e.target.value})}
                  placeholder="Estimated read time..."
                />
              </div>

              <div className="form-group">
                <label>Personalized Score (1-10) *</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={newNewsData.score}
                  onChange={(e) => setNewNewsData({...newNewsData, score: e.target.value})}
                  placeholder="Your rating..."
                />
                <div className="input-note">FHE Encrypted Integer</div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createNews}
                disabled={creatingNews || isEncrypting || !newNewsData.title || !newNewsData.score}
                className="submit-btn"
              >
                {creatingNews || isEncrypting ? "Encrypting..." : "Submit Article"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedNews && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>{selectedNews.title}</h2>
              <button onClick={() => setSelectedNews(null)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="news-meta">
                <span className="category-badge">{selectedNews.category}</span>
                <span>👁️ {selectedNews.publicViews} views</span>
                <span>⏱️ {selectedNews.readTime} min read</span>
                <span>By {selectedNews.creator.substring(0, 8)}...</span>
              </div>

              <div className="content-placeholder">
                <p>This is a placeholder for the actual news content. In a real implementation, this would contain the full article text.</p>
                <p>The FHE system protects your personalized scoring while allowing for encrypted processing of reading preferences.</p>
              </div>

              <div className="fhe-section">
                <h3>🔐 Encrypted Preference Score</h3>
                <div className="score-display">
                  <div className="score-value">
                    {selectedNews.isVerified ? 
                      `Decrypted Score: ${selectedNews.decryptedScore}/10` : 
                      "🔒 Score Encrypted with FHE"
                    }
                  </div>
                  <button
                    className={`decrypt-btn ${selectedNews.isVerified ? 'verified' : ''}`}
                    onClick={() => decryptScore(selectedNews.id)}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? "Decrypting..." : 
                     selectedNews.isVerified ? "✅ Verified" : "🔓 Decrypt Score"}
                  </button>
                </div>
                <p className="fhe-explanation">
                  Your personalized score is processed using homomorphic encryption without exposing your actual preferences.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </div>
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

