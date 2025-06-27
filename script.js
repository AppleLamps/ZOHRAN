// DOM elements
const container = document.getElementById('posts-container');
const loading = document.getElementById('loading');
const infiniteLoading = document.getElementById('infinite-loading');
const emptyState = document.getElementById('empty-state');
const postCountElement = document.getElementById('post-count');
const searchSection = document.getElementById('search-section');
const searchInput = document.getElementById('search-input');
const clearButton = document.getElementById('clear-search');
const searchResults = document.getElementById('search-results');

// Global variables
let allPosts = [];
let filteredPosts = [];
let currentSearchTerm = '';
let observer;
const POSTS_PER_PAGE = 25;
let currentPage = 0;
let isLoading = false;

// Load and display posts
async function loadPosts() {
    try {
        const response = await fetch('ZohranKMamdani_X_posts.json');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const posts = await response.json();
        
        allPosts = posts.filter(post => post.text && post.text.trim() !== "");
        filteredPosts = [...allPosts];
        
        loading.style.display = 'none';
        
        if (allPosts.length === 0) {
            emptyState.style.display = 'flex';
            postCountElement.textContent = '0 posts';
            postCountElement.style.display = 'block';
            return;
        }
        
        searchSection.style.display = 'block';
        container.style.display = 'grid';
        
        updatePostCount();
        postCountElement.style.display = 'block';
        setupIntersectionObserver();
        loadMorePosts();
        
        initializeSearch();
        
    } catch (error) {
        console.error('Error loading posts:', error);
        showError(error.message);
    }
}

function setupIntersectionObserver() {
    const options = {
        root: null,
        rootMargin: '200px',
        threshold: 0.1
    };

    observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !isLoading) {
                loadMorePosts();
            }
        });
    }, options);
}

function loadMorePosts() {
    if (isLoading) return;
    
    const start = currentPage * POSTS_PER_PAGE;
    const end = start + POSTS_PER_PAGE;
    const postsToRender = filteredPosts.slice(start, end);

    if (postsToRender.length === 0 && currentPage > 0) {
        // No more posts to load
        infiniteLoading.style.display = 'none';
        if (observer) {
            observer.disconnect();
        }
        return;
    }
    
    isLoading = true;
    
    // Show loading indicator for subsequent loads
    if (currentPage > 0) {
        infiniteLoading.style.display = 'block';
    }
    
    requestAnimationFrame(() => {
        displayPosts(postsToRender);
        currentPage++;
        isLoading = false;
        
        // Hide loading indicator
        infiniteLoading.style.display = 'none';

        const lastPost = container.querySelector('.post:last-child');
        if (lastPost && observer && currentPage * POSTS_PER_PAGE < filteredPosts.length) {
            observer.observe(lastPost);
        }
    });
}

// Display posts with animation
function displayPosts(posts, isSearch = false) {
    if (isSearch) {
        container.innerHTML = '';
        currentPage = 0;
        isLoading = false;
        if (observer) {
            observer.disconnect();
        }
        setupIntersectionObserver();
        loadMorePosts();
        return;
    }

    if (posts.length === 0 && currentPage === 0) {
        showNoResults();
        return;
    }
    
    const fragment = document.createDocumentFragment();
    
    posts.forEach((post, index) => {
        const postElement = createPostElement(post, (currentPage * POSTS_PER_PAGE) + index, isSearch);
        fragment.appendChild(postElement);
    });
    
    container.appendChild(fragment);
}

// Create individual post element
function createPostElement(post, index, isSearch = false) {
    const postDiv = document.createElement('div');
    postDiv.className = 'post';
    
    const formattedDate = formatDate(post.created_at);
    
    const highlightedText = highlightSearchTerm(post.text, currentSearchTerm);
    const highlightedHandle = highlightSearchTerm(post.user_screen_name || 'ZohranKMamdani', currentSearchTerm);

    const fullDate = formatFullDate(post.created_at);
    
    // Create the post link if available
    const postLink = post.link || '#';
    
    postDiv.innerHTML = `
        <div class="post-avatar">
            <img src="profile.png" alt="Profile" />
        </div>
        <div class="post-content">
            <div class="meta">
                <span class="handle">${highlightedHandle}</span>
                <div class="separator"></div>
                <a href="${postLink}" target="_blank" rel="noopener noreferrer" class="date" title="${fullDate}">${formattedDate}</a>
            </div>
            <div class="text">${highlightedText}</div>
            <div class="post-actions">
                <a href="${postLink}" target="_blank" rel="noopener noreferrer" class="post-link" title="View post on X">
                    <span class="material-symbols-outlined">open_in_new</span>
                    <span>View on X</span>
                </a>
            </div>
        </div>
    `;
    
    // Make the entire post clickable except for links
    postDiv.addEventListener('click', (e) => {
        // Don't trigger if clicking on a link or button
        if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || e.target.closest('a')) {
            return;
        }
        
        // Open the post in a new tab
        if (postLink && postLink !== '#') {
            window.open(postLink, '_blank', 'noopener,noreferrer');
        }
    });
    
    return postDiv;
}

// Highlight search terms
function highlightSearchTerm(text, searchTerm) {
    if (!searchTerm || !text) return escapeHTML(text);
    
    const escapedText = escapeHTML(text);
    const regex = new RegExp(`(${escapeRegex(searchTerm)})`, 'gi');
    return escapedText.replace(regex, '<mark style="background: #fef08a; padding: 0.125rem 0.25rem; border-radius: 0.25rem; font-weight: 600;">$1</mark>');
}

// Escape regex special characters
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Initialize search functionality
function initializeSearch() {
    searchInput.addEventListener('input', debounce(handleSearch, 300));
    clearButton.addEventListener('click', clearSearch);
    
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSearch();
        }
    });
}

// Handle search input
function handleSearch() {
    const searchTerm = searchInput.value.trim().toLowerCase();
    currentSearchTerm = searchTerm;
    
    clearButton.style.display = searchTerm ? 'block' : 'none';
    
    if (!searchTerm) {
        filteredPosts = [...allPosts];
    } else {
        filteredPosts = allPosts.filter(post => {
            const textMatch = post.text && post.text.toLowerCase().includes(searchTerm);
            const handleMatch = post.user_screen_name && post.user_screen_name.toLowerCase().includes(searchTerm);
            return textMatch || handleMatch;
        });
    }
    
    updatePostCount();
    postCountElement.style.display = 'block';
    displayPosts(filteredPosts, true);
    updateSearchResults(searchTerm);
}

// Clear search
function clearSearch() {
    searchInput.value = '';
    currentSearchTerm = '';
    clearButton.style.display = 'none';
    filteredPosts = [...allPosts];
    updatePostCount();
    displayPosts(filteredPosts, true);
    searchResults.textContent = '';
}

// Update search results text
function updateSearchResults(searchTerm) {
    if (!searchTerm) {
        searchResults.textContent = '';
        return;
    }
    
    const count = filteredPosts.length;
    const totalCount = allPosts.length;
    
    if (count === 0) {
        searchResults.innerHTML = `No results found for "<strong>${escapeHTML(searchTerm)}</strong>"`;
    } else if (count === totalCount) {
        searchResults.innerHTML = `All ${count} posts match "<strong>${escapeHTML(searchTerm)}</strong>"`;
    } else {
        searchResults.innerHTML = `Found ${count} of ${totalCount} posts matching "<strong>${escapeHTML(searchTerm)}</strong>"`;
    }
}

// Update post count
function updatePostCount() {
    const count = filteredPosts.length;
    const total = allPosts.length;
    
    if (currentSearchTerm && count !== total) {
        postCountElement.textContent = `${count} / ${total} posts`;
    } else {
        postCountElement.textContent = `${total} posts`;
    }
}

// Show no results message
function showNoResults() {
    container.innerHTML = `
        <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 16px;
            text-align: center;
            color: var(--text-secondary);
            min-height: 300px;
        ">
            <span class="material-symbols-outlined" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;">search_off</span>
            <h3 style="margin-bottom: 8px; color: var(--text-primary); font-weight: 800; font-size: 20px;">No posts found</h3>
            <p style="font-size: 15px; color: var(--text-secondary); margin: 0;">Try adjusting your search terms or <button onclick="clearSearch()" style="background: none; border: none; color: var(--primary-color); cursor: pointer; text-decoration: underline; font: inherit;">clear the search</button></p>
        </div>
    `;
}

// Debounce function for search
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Format date string
function formatDate(dateString) {
    if (!dateString) return 'Unknown date';
    
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffMinutes = Math.floor(diffTime / (1000 * 60));
        const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffMinutes < 60) {
            return diffMinutes === 0 ? 'now' : `${diffMinutes}m`;
        } else if (diffHours < 24) {
            return `${diffHours}h`;
        } else if (diffDays < 30) {
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            });
        } else {
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }
    } catch (error) {
        return dateString;
    }
}

// Format full date with time for hover title
function formatFullDate(dateString) {
    if (!dateString) return 'Unknown date';
    
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    } catch (error) {
        return dateString;
    }
}

// Show error message
function showError(message) {
    loading.style.display = 'none';
    container.innerHTML = '';
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-state';
    errorDiv.innerHTML = `
        <span class="material-symbols-outlined">error</span>
        <h2>Failed to Load Posts</h2>
        <p>There was an issue fetching the posts. Please try again later.</p>
        <small>Error: ${escapeHTML(message)}</small>
    `;
    container.appendChild(errorDiv);
    container.style.display = 'block';
}

// Enhanced HTML escape function
function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Add smooth scrolling for better UX
function addSmoothScrolling() {
    document.documentElement.style.scrollBehavior = 'smooth';
}

// Initialize the application
function init() {
    addSmoothScrolling();
    loadPosts();
}

// Start the application when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
