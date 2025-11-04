pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract NewsFeedFHE is ZamaEthereumConfig {
    struct EncryptedPreference {
        euint32 encryptedWeight;
        uint256 lastUpdated;
        bool isActive;
    }

    struct NewsArticle {
        string contentHash;
        uint256 publishTimestamp;
        euint32 encryptedScore;
        address publisher;
        bool isActive;
    }

    mapping(address => mapping(uint256 => EncryptedPreference)) public userPreferences;
    mapping(uint256 => NewsArticle) public newsArticles;
    mapping(address => uint256[]) public userArticleList;

    event PreferenceRegistered(address indexed user, uint256 indexed tag, uint256 timestamp);
    event ArticlePublished(uint256 indexed articleId, address indexed publisher, uint256 timestamp);
    event ArticleRecommended(address indexed user, uint256 indexed articleId, uint256 timestamp);

    constructor() ZamaEthereumConfig() {
    }

    function registerPreference(
        uint256 tag,
        externalEuint32 encryptedWeight,
        bytes calldata inputProof
    ) external {
        require(FHE.isInitialized(FHE.fromExternal(encryptedWeight, inputProof)), "Invalid encrypted input");
        
        euint32 encryptedValue = FHE.fromExternal(encryptedWeight, inputProof);
        FHE.allowThis(encryptedValue);
        FHE.makePubliclyDecryptable(encryptedValue);

        userPreferences[msg.sender][tag] = EncryptedPreference({
            encryptedWeight: encryptedValue,
            lastUpdated: block.timestamp,
            isActive: true
        });

        emit PreferenceRegistered(msg.sender, tag, block.timestamp);
    }

    function publishArticle(
        string calldata contentHash,
        externalEuint32 encryptedScore,
        bytes calldata inputProof
    ) external returns (uint256) {
        require(FHE.isInitialized(FHE.fromExternal(encryptedScore, inputProof)), "Invalid encrypted input");
        
        euint32 encryptedValue = FHE.fromExternal(encryptedScore, inputProof);
        FHE.allowThis(encryptedValue);
        FHE.makePubliclyDecryptable(encryptedValue);

        uint256 articleId = uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender)));
        
        newsArticles[articleId] = NewsArticle({
            contentHash: contentHash,
            publishTimestamp: block.timestamp,
            encryptedScore: encryptedValue,
            publisher: msg.sender,
            isActive: true
        });

        emit ArticlePublished(articleId, msg.sender, block.timestamp);
        return articleId;
    }

    function recommendArticles(
        address user,
        uint256[] calldata articleIds,
        externalEuint32[] calldata encryptedScores,
        bytes[] calldata inputProofs
    ) external {
        require(articleIds.length == encryptedScores.length, "Invalid input lengths");
        require(articleIds.length == inputProofs.length, "Invalid input lengths");
        
        for (uint i = 0; i < articleIds.length; i++) {
            require(newsArticles[articleIds[i]].isActive, "Article inactive");
            require(FHE.isInitialized(FHE.fromExternal(encryptedScores[i], inputProofs[i])), "Invalid encrypted input");
            
            euint32 encryptedValue = FHE.fromExternal(encryptedScores[i], inputProofs[i]);
            FHE.allowThis(encryptedValue);
            FHE.makePubliclyDecryptable(encryptedValue);

            userArticleList[user].push(articleIds[i]);
            emit ArticleRecommended(user, articleIds[i], block.timestamp);
        }
    }

    function getPreference(address user, uint256 tag) external view returns (euint32, uint256, bool) {
        EncryptedPreference storage pref = userPreferences[user][tag];
        return (pref.encryptedWeight, pref.lastUpdated, pref.isActive);
    }

    function getArticle(uint256 articleId) external view returns (
        string memory,
        uint256,
        euint32,
        address,
        bool
    ) {
        NewsArticle storage article = newsArticles[articleId];
        return (article.contentHash, article.publishTimestamp, article.encryptedScore, article.publisher, article.isActive);
    }

    function getUserArticles(address user) external view returns (uint256[] memory) {
        return userArticleList[user];
    }

    function deactivatePreference(uint256 tag) external {
        userPreferences[msg.sender][tag].isActive = false;
    }

    function deactivateArticle(uint256 articleId) external {
        require(newsArticles[articleId].publisher == msg.sender, "Only publisher can deactivate");
        newsArticles[articleId].isActive = false;
    }

    function computeRecommendationScore(
        euint32 encryptedPreference,
        euint32 encryptedArticleScore
    ) external view returns (euint32) {
        require(FHE.isInitialized(encryptedPreference), "Invalid encrypted preference");
        require(FHE.isInitialized(encryptedArticleScore), "Invalid encrypted article score");
        
        return encryptedPreference * encryptedArticleScore;
    }
}

