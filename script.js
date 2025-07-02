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

// Date filter elements
const toggleDateFilter = document.getElementById('toggle-date-filter');
const dateFilterControls = document.getElementById('date-filter-controls');
const startDateInput = document.getElementById('start-date');
const endDateInput = document.getElementById('end-date');
const applyDateFilter = document.getElementById('apply-date-filter');
const clearDateFilter = document.getElementById('clear-date-filter');
const presetButtons = document.querySelectorAll('.preset-btn');

// Global variables
let allPosts = [];
let filteredPosts = [];
let currentSearchTerm = '';
let currentStartDate = null;
let currentEndDate = null;
let observer;
const POSTS_PER_PAGE = 25;
let currentPage = 0;
let isLoading = false;

// Enhanced search functionality with stopwords and stemming
const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he', 'in', 'is', 'it',
    'its', 'of', 'on', 'that', 'the', 'to', 'was', 'will', 'with', 'would', 'i', 'you', 'we', 'they',
    'she', 'her', 'him', 'his', 'my', 'our', 'your', 'their', 'this', 'these', 'those', 'but', 'or',
    'not', 'can', 'do', 'have', 'had', 'been', 'were', 'am', 'all', 'any', 'some', 'if', 'so', 'what',
    'when', 'where', 'who', 'why', 'how', 'there', 'here', 'then', 'than', 'more', 'most', 'much',
    'many', 'very', 'just', 'only', 'also', 'even', 'still', 'now', 'get', 'got', 'go', 'going', 'come',
    'came', 'see', 'saw', 'know', 'knew', 'think', 'thought', 'say', 'said', 'tell', 'told', 'ask',
    'asked', 'give', 'gave', 'take', 'took', 'make', 'made', 'want', 'wanted', 'need', 'needed', 'try',
    'tried', 'look', 'looked', 'feel', 'felt', 'seem', 'seemed', 'find', 'found', 'work', 'worked',
    'use', 'used', 'call', 'called', 'way', 'ways', 'time', 'times', 'day', 'days', 'year', 'years',
    'new', 'old', 'first', 'last', 'long', 'good', 'great', 'little', 'own', 'other', 'right', 'left',
    'high', 'low', 'big', 'small', 'large', 'next', 'early', 'young', 'important', 'few', 'public',
    'bad', 'same', 'able'
]);

// Simple stemming rules
const STEMMING_RULES = [
    { pattern: /ies$/, replacement: 'y' },
    { pattern: /ied$/, replacement: 'y' },
    { pattern: /ying$/, replacement: 'y' },
    { pattern: /ing$/, replacement: '' },
    { pattern: /ly$/, replacement: '' },
    { pattern: /ed$/, replacement: '' },
    { pattern: /ies$/, replacement: 'y' },
    { pattern: /ied$/, replacement: 'y' },
    { pattern: /ies$/, replacement: 'y' },
    { pattern: /s$/, replacement: '' }
];

// Normalize text for searching (remove accents, etc.)
function normalizeText(text) {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Simple stemming function
function stemWord(word) {
    if (word.length <= 3) return word;
    
    for (let rule of STEMMING_RULES) {
        if (rule.pattern.test(word)) {
            let stemmed = word.replace(rule.pattern, rule.replacement);
            if (stemmed.length >= 2) {
                return stemmed;
            }
        }
    }
    return word;
}

// Process search terms (normalize, remove stopwords, stem)
function processSearchTerms(searchText) {
    if (!searchText || typeof searchText !== 'string') {
        return [];
    }
    
    const normalized = normalizeText(searchText.trim());
    if (normalized.length === 0) {
        return [];
    }
    
    const words = normalized.split(/\s+/).filter(word => word.length > 0);
    
    return words
        .filter(word => !STOPWORDS.has(word) && word.length > 0)
        .map(word => ({
            original: word,
            stemmed: stemWord(word)
        }));
}

// Check if word matches (exact match or meaningful partial match)
function wordMatch(word, target) {
    if (word === target) return true;
    
    // Only check meaningful partial matches for words of reasonable length
    if (word.length >= 3 && target.length >= 3) {
        // Only match if one word starts with the other (prefix matching)
        // This prevents "iran" from matching "ran" but allows "child" to match "childcare"
        if (target.startsWith(word) || word.startsWith(target)) return true;
    }
    
    // For shorter words, only allow exact matches
    if (word.length < 3 || target.length < 3) {
        return word === target;
    }
    
    return false;
}

// Get all searchable text from a post
function getSearchableText(post) {
    const fields = [
        post.text || '',
        post.user_screen_name || '',
        post.user_name || ''
        // Removed potentially empty/undefined fields that might cause issues
    ];
    
    return fields.filter(field => field && field.trim()).join(' ').toLowerCase();
}

// Enhanced search function
function enhancedSearch(posts, searchTerms) {
    if (!searchTerms || searchTerms.length === 0) {
        return posts;
    }
    
    return posts.filter(post => {
        const searchableText = normalizeText(getSearchableText(post));
        const searchableWords = searchableText.split(/\s+/).filter(word => word.length > 0);
        
        // All search terms must match (AND logic)
        return searchTerms.every(term => {
            // Skip empty terms
            if (!term.original || term.original.length === 0) {
                return true;
            }
            
            // Check exact match first
            if (searchableText.includes(term.original)) {
                return true;
            }
            
            // Check stemmed match
            if (searchableWords.some(word => stemWord(word) === term.stemmed)) {
                return true;
            }
            
            // Check word match (exact or partial)
            return searchableWords.some(word => {
                // Only do matching if both words are meaningful length
                if (word.length >= 2 && term.original.length >= 2) {
                    return wordMatch(term.original, word) || 
                           wordMatch(term.stemmed, stemWord(word));
                }
                return false;
            });
        });
    });
}

// Enhanced highlighting function
function highlightSearchTerm(text, searchTerm) {
    if (!searchTerm || !text) return escapeHTML(text);
    
    const processedTerms = processSearchTerms(searchTerm);
    if (processedTerms.length === 0) return escapeHTML(text);
    
    let highlightedText = escapeHTML(text);
    const normalizedText = normalizeText(text);
    
    // Create a map of positions to highlight
    const highlights = [];
    
    processedTerms.forEach(term => {
        // Find exact matches
        let index = 0;
        while ((index = normalizedText.indexOf(term.original, index)) !== -1) {
            highlights.push({ start: index, end: index + term.original.length });
            index += term.original.length;
        }
        
        // Find partial matches
        const words = normalizedText.split(/(\s+)/);
        let currentPos = 0;
        
        words.forEach(word => {
            const cleanWord = word.replace(/[^\w]/g, '');
            if (cleanWord.length > 0) {
                if (wordMatch(term.original, cleanWord) || 
                    wordMatch(term.stemmed, stemWord(cleanWord))) {
                    highlights.push({ 
                        start: currentPos, 
                        end: currentPos + word.length 
                    });
                }
            }
            currentPos += word.length;
        });
    });
    
    // Sort highlights by position and merge overlapping ones
    highlights.sort((a, b) => a.start - b.start);
    const mergedHighlights = [];
    
    highlights.forEach(highlight => {
        const last = mergedHighlights[mergedHighlights.length - 1];
        if (last && highlight.start <= last.end) {
            last.end = Math.max(last.end, highlight.end);
        } else {
            mergedHighlights.push(highlight);
        }
    });
    
    // Apply highlights from right to left to preserve positions
    mergedHighlights.reverse().forEach(highlight => {
        const before = highlightedText.substring(0, highlight.start);
        const match = highlightedText.substring(highlight.start, highlight.end);
        const after = highlightedText.substring(highlight.end);
        
        highlightedText = before + 
            '<mark style="background: #fef08a; padding: 0.125rem 0.25rem; border-radius: 0.25rem; font-weight: 600;">' + 
            match + 
            '</mark>' + 
            after;
    });
    
    return highlightedText;
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
    
    // Initialize search help
    const searchHelpButton = document.getElementById('search-help');
    const searchHelpPanel = document.getElementById('search-help-panel');
    
    if (searchHelpButton && searchHelpPanel) {
        searchHelpButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            searchHelpPanel.classList.toggle('show');
        });
        
        // Close help panel when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchHelpPanel.contains(e.target) && !searchHelpButton.contains(e.target)) {
                searchHelpPanel.classList.remove('show');
            }
        });
        
        // Close help panel when starting to type
        searchInput.addEventListener('focus', () => {
            searchHelpPanel.classList.remove('show');
        });
    }
}

// Handle search input with enhanced search
function handleSearch() {
    const searchTerm = searchInput.value.trim();
    currentSearchTerm = searchTerm;
    
    clearButton.style.display = searchTerm ? 'block' : 'none';
    
    applyFilters();
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
    applyFilters();
    updatePostCount();
    displayPosts(filteredPosts, true);
    searchResults.textContent = '';
}

// Initialize date filter functionality
function initializeDateFilter() {
    // Toggle date filter visibility
    toggleDateFilter.addEventListener('click', () => {
        const isExpanded = dateFilterControls.classList.contains('expanded');
        dateFilterControls.classList.toggle('expanded');
        toggleDateFilter.classList.toggle('expanded');
    });

    // Apply date filter
    applyDateFilter.addEventListener('click', handleDateFilter);
    
    // Clear date filter
    clearDateFilter.addEventListener('click', clearDateFilters);
    
    // Date preset buttons
    presetButtons.forEach(button => {
        button.addEventListener('click', () => {
            const days = parseInt(button.dataset.days);
            applyDatePreset(days);
            button.classList.add('active');
            
            // Remove active class from other preset buttons
            presetButtons.forEach(btn => {
                if (btn !== button) btn.classList.remove('active');
            });
        });
    });
    
    // Date input changes
    startDateInput.addEventListener('change', validateDateInputs);
    endDateInput.addEventListener('change', validateDateInputs);
}

// Apply all filters (enhanced search + date)
function applyFilters() {
    let filtered = [...allPosts];
    
    // Apply enhanced search filter
    if (currentSearchTerm) {
        const searchTerms = processSearchTerms(currentSearchTerm);
        filtered = enhancedSearch(filtered, searchTerms);
    }
    
    // Apply date filter
    if (currentStartDate || currentEndDate) {
        filtered = filtered.filter(post => {
            const postDate = parsePostDate(post.created_at);
            if (!postDate) return false;
            
            if (currentStartDate && postDate < currentStartDate) return false;
            if (currentEndDate && postDate > currentEndDate) return false;
            
            return true;
        });
    }
    
    filteredPosts = filtered;
}

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
        initializeDateFilter();
        
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
    
    // Get post type and create type indicator
    const postType = post.type || 'Post';
    const typeClass = postType.toLowerCase();
    const typeIcon = postType === 'Reply' ? 'reply' : (postType === 'Repost' ? 'repeat' : 'edit_note');
    
    postDiv.innerHTML = `
        <div class="post-avatar">
            <img src="profile.png" alt="Profile" />
        </div>
        <div class="post-content">
            <div class="meta">
                <span class="handle">${highlightedHandle}</span>
                <div class="separator"></div>
                <a href="${postLink}" target="_blank" rel="noopener noreferrer" class="date" title="${fullDate}">${formattedDate}</a>
                <div class="separator"></div>
                <span class="post-type ${typeClass}">
                    <span class="material-symbols-outlined">${typeIcon}</span>
                    <span>${postType}</span>
                </span>
                <div class="separator"></div>
                <a href="${postLink}" target="_blank" rel="noopener noreferrer" class="post-link-inline" title="View post on X">
                    <span class="material-symbols-outlined">open_in_new</span>
                </a>
            </div>
            <div class="text">${highlightedText}</div>
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

// Parse post date from string format "M/D/YYYY H:MM"
function parsePostDate(dateString) {
    if (!dateString) return null;
    
    try {
        // Handle format like "6/28/2025 10:56"
        const [datePart, timePart] = dateString.split(' ');
        const [month, day, year] = datePart.split('/');
        const [hour, minute] = timePart ? timePart.split(':') : ['0', '0'];
        
        return new Date(year, month - 1, day, hour, minute);
    } catch (error) {
        console.warn('Failed to parse date:', dateString);
        return null;
    }
}

// Handle date filter application
function handleDateFilter() {
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;
    
    currentStartDate = startDate ? new Date(startDate) : null;
    currentEndDate = endDate ? new Date(endDate + 'T23:59:59') : null; // End of day
    
    applyFilters();
    updatePostCount();
    displayPosts(filteredPosts, true);
    updateDateFilterResults();
}

// Clear date filters
function clearDateFilters() {
    startDateInput.value = '';
    endDateInput.value = '';
    currentStartDate = null;
    currentEndDate = null;
    
    // Remove active class from preset buttons
    presetButtons.forEach(btn => btn.classList.remove('active'));
    
    applyFilters();
    updatePostCount();
    displayPosts(filteredPosts, true);
    updateDateFilterResults();
}

// Apply date preset (last N days)
function applyDatePreset(days) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);
    
    // Set input values
    startDateInput.value = startDate.toISOString().split('T')[0];
    endDateInput.value = endDate.toISOString().split('T')[0];
    
    // Apply filter
    currentStartDate = startDate;
    currentEndDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000 - 1); // End of day
    
    applyFilters();
    updatePostCount();
    displayPosts(filteredPosts, true);
    updateDateFilterResults();
}

// Validate date inputs
function validateDateInputs() {
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;
    
    if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (start > end) {
            startDateInput.setCustomValidity('Start date must be before end date');
            endDateInput.setCustomValidity('End date must be after start date');
        } else {
            startDateInput.setCustomValidity('');
            endDateInput.setCustomValidity('');
        }
    }
}

// Update date filter results display
function updateDateFilterResults() {
    if (!currentStartDate && !currentEndDate) return;
    
    const hasSearch = !!currentSearchTerm;
    const dateRange = formatDateRange(currentStartDate, currentEndDate);
    
    if (hasSearch) {
        searchResults.innerHTML += ` <span style="color: var(--text-muted);">• Filtered by date: ${dateRange}</span>`;
    } else {
        searchResults.innerHTML = `Showing posts from ${dateRange}`;
    }
}

// Format date range for display
function formatDateRange(startDate, endDate) {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    
    if (startDate && endDate) {
        return `${startDate.toLocaleDateString('en-US', options)} - ${endDate.toLocaleDateString('en-US', options)}`;
    } else if (startDate) {
        return `${startDate.toLocaleDateString('en-US', options)} onwards`;
    } else if (endDate) {
        return `up to ${endDate.toLocaleDateString('en-US', options)}`;
    }
    
    return '';
}

// Update search results text with enhanced search info
function updateSearchResults(searchTerm) {
    if (!searchTerm) {
        searchResults.textContent = '';
        return;
    }
    
    const count = filteredPosts.length;
    const totalCount = allPosts.length;
    const processedTerms = processSearchTerms(searchTerm);
    
    if (count === 0) {
        searchResults.innerHTML = `No results found for "<strong>${escapeHTML(searchTerm)}</strong>"`;
    } else if (count === totalCount) {
        searchResults.innerHTML = `All ${count} posts match "<strong>${escapeHTML(searchTerm)}</strong>"`;
    } else {
        const searchInfo = processedTerms.length > 0 ? 
            `<br><span style="color: var(--text-muted); font-size: 0.875rem;">
                Searching for: ${processedTerms.map(t => `"${t.original}"`).join(', ')}${processedTerms.some(t => t.original !== t.stemmed) ? ' (including word variations)' : ''}
            </span>` : '';
        
        searchResults.innerHTML = `Found ${count} of ${totalCount} posts matching "<strong>${escapeHTML(searchTerm)}</strong>"${searchInfo}`;
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

// Handle responsive placeholder text
function updateSearchPlaceholder() {
    const searchInput = document.getElementById('search-input');
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        searchInput.placeholder = "Search posts...";
    } else {
        searchInput.placeholder = "Search posts (try: 'rent freeze', 'childcare', 'buses')...";
    }
}

// Initialize the application
function init() {
    addSmoothScrolling();
    loadPosts();
    initializeSearch();
    initializeDateFilter();
    updateSearchPlaceholder();
    initializeTabSwitching();
    initializeDonorDatabase();
    
    // Update placeholder on window resize
    window.addEventListener('resize', updateSearchPlaceholder);
}

// ===== DONOR DATABASE FUNCTIONALITY =====

// Donor database variables
let allDonors = [];
let filteredDonors = [];
let currentDonorSearchTerm = '';
let currentFilters = {
    amount: '',
    borough: '',
    intermediary: '',
    sort: 'date-desc'
};

// Initialize tab switching
function initializeTabSwitching() {
    const navLinks = document.querySelectorAll('.nav-link');
    const tabContents = document.querySelectorAll('.tab-content');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = link.getAttribute('data-tab');
            
            // Update active nav link
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            // Show target tab content
            tabContents.forEach(tab => {
                if (tab.id === `${targetTab}-tab`) {
                    tab.style.display = 'block';
                } else {
                    tab.style.display = 'none';
                }
            });
            
            // Load donor data if switching to donors tab
            if (targetTab === 'donors' && allDonors.length === 0) {
                loadDonorData();
            }
        });
    });
}

// Initialize donor database
function initializeDonorDatabase() {
    // Search functionality
    const donorSearchInput = document.getElementById('donors-search-input');
    const clearDonorSearch = document.getElementById('clear-donors-search');
    
    if (donorSearchInput) {
        donorSearchInput.addEventListener('input', debounce(handleDonorSearch, 300));
    }
    
    if (clearDonorSearch) {
        clearDonorSearch.addEventListener('click', clearDonorSearchHandler);
    }
    
    // Filter functionality
    const filters = ['amount-filter', 'borough-filter', 'intermediary-filter', 'sort-filter'];
    filters.forEach(filterId => {
        const filterElement = document.getElementById(filterId);
        if (filterElement) {
            filterElement.addEventListener('change', handleDonorFilters);
        }
    });
    
    // Reset filters functionality
    const resetFiltersBtn = document.getElementById('reset-filters');
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', resetAllFilters);
    }
}

// Load donor data from JSON
async function loadDonorData() {
    const donorLoading = document.getElementById('donors-loading');
    const donorContainer = document.getElementById('donors-container');
    const donorEmptyState = document.getElementById('donors-empty-state');
    
    try {
        donorLoading.style.display = 'flex';
        donorContainer.style.display = 'none';
        donorEmptyState.style.display = 'none';
        
        const response = await fetch('zohran-donor.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        allDonors = await response.json();
        
        // Process and clean the data
        allDonors = allDonors.map((donor, index) => ({
            ...donor,
            id: index,
            // Clean and parse numeric values
            DONATION: parseFloat(donor.DONATION) || 0,
            'MATCH-AMOUNT': parseFloat(donor['MATCH-AMOUNT']) || 0,
            // Parse date
            donationDate: parseDonorDate(donor['DATE OF DONATION']),
            // Check if via intermediary
            hasIntermediary: !!(donor.INTERMEDIARY_NAME && donor.INTERMEDIARY_NAME.trim())
        }));
        
        filteredDonors = [...allDonors];
        
        updateDonorAnalytics();
        displayDonors();
        
    } catch (error) {
        console.error('Error loading donor data:', error);
        showDonorError('Failed to load donor data. Please try again later.');
    } finally {
        donorLoading.style.display = 'none';
    }
}

// Parse date in various formats
function parseDonorDate(dateString) {
    if (!dateString) return null;
    
    // Try different date formats
    const formats = [
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,  // M/D/YYYY
        /^(\d{4})-(\d{2})-(\d{2})$/,        // YYYY-MM-DD
        /^(\d{2})-(\d{2})-(\d{4})$/         // MM-DD-YYYY
    ];
    
    for (let format of formats) {
        const match = dateString.match(format);
        if (match) {
            if (format === formats[0]) { // M/D/YYYY
                return new Date(match[3], match[1] - 1, match[2]);
            } else if (format === formats[1]) { // YYYY-MM-DD
                return new Date(match[1], match[2] - 1, match[3]);
            } else if (format === formats[2]) { // MM-DD-YYYY
                return new Date(match[3], match[1] - 1, match[2]);
            }
        }
    }
    
    // Fallback to Date constructor
    const parsed = new Date(dateString);
    return isNaN(parsed.getTime()) ? null : parsed;
}

// Update analytics dashboard
function updateDonorAnalytics() {
    const totalDonations = allDonors.reduce((sum, donor) => sum + donor.DONATION, 0);
    const totalDonors = allDonors.length;
    const intermediaryDonations = allDonors
        .filter(donor => donor.hasIntermediary)
        .reduce((sum, donor) => sum + donor.DONATION, 0);
    const averageDonation = totalDonors > 0 ? totalDonations / totalDonors : 0;
    
    // Update analytics display
    document.getElementById('total-donations').textContent = formatCurrency(totalDonations);
    document.getElementById('total-donors').textContent = totalDonors.toLocaleString();
    document.getElementById('intermediary-donations').textContent = formatCurrency(intermediaryDonations);
    document.getElementById('average-donation').textContent = formatCurrency(averageDonation);
    
    // Update donors count
    document.getElementById('donors-count').textContent = 
        `${filteredDonors.length.toLocaleString()} of ${totalDonors.toLocaleString()} donors`;
    
    // Update reset button state when analytics are updated
    updateResetButtonState();
}

// Format currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

// Handle donor search
function handleDonorSearch() {
    const searchInput = document.getElementById('donors-search-input');
    currentDonorSearchTerm = searchInput.value.trim();
    applyDonorFilters();
}

// Clear donor search
function clearDonorSearchHandler() {
    const searchInput = document.getElementById('donors-search-input');
    searchInput.value = '';
    currentDonorSearchTerm = '';
    applyDonorFilters();
}

// Handle donor filters
function handleDonorFilters() {
    currentFilters.amount = document.getElementById('amount-filter').value;
    currentFilters.borough = document.getElementById('borough-filter').value;
    currentFilters.intermediary = document.getElementById('intermediary-filter').value;
    currentFilters.sort = document.getElementById('sort-filter').value;
    
    applyDonorFilters();
}

// Apply all donor filters
function applyDonorFilters() {
    filteredDonors = [...allDonors];
    
    // Apply search filter
    if (currentDonorSearchTerm) {
        const searchTerms = processSearchTerms(currentDonorSearchTerm);
        filteredDonors = filteredDonors.filter(donor => {
            const searchableText = normalizeText([
                donor.NAME || '',
                donor.CITY || '',
                donor.STATE || '',
                donor.EMPCITY || '',
                donor.EMPSTATE || '',
                donor.INTERMEDIARY_NAME || ''
            ].join(' '));
            
            return searchTerms.every(term => {
                return searchableText.includes(term.original) ||
                       searchableText.includes(term.stemmed);
            });
        });
    }
    
    // Apply amount filter
    if (currentFilters.amount) {
        filteredDonors = filteredDonors.filter(donor => {
            const amount = donor.DONATION;
            switch (currentFilters.amount) {
                case '0-25': return amount >= 0 && amount <= 25;
                case '25-100': return amount > 25 && amount <= 100;
                case '100-500': return amount > 100 && amount <= 500;
                case '500+': return amount > 500;
                default: return true;
            }
        });
    }
    
    // Apply borough filter
    if (currentFilters.borough) {
        filteredDonors = filteredDonors.filter(donor => 
            donor.BOROUGHCD === currentFilters.borough
        );
    }
    
    // Apply intermediary filter
    if (currentFilters.intermediary) {
        if (currentFilters.intermediary === 'yes') {
            filteredDonors = filteredDonors.filter(donor => donor.hasIntermediary);
        } else if (currentFilters.intermediary === 'no') {
            filteredDonors = filteredDonors.filter(donor => !donor.hasIntermediary);
        }
    }
    
    // Apply sorting
    filteredDonors.sort((a, b) => {
        switch (currentFilters.sort) {
            case 'date-desc':
                return (b.donationDate || 0) - (a.donationDate || 0);
            case 'date-asc':
                return (a.donationDate || 0) - (b.donationDate || 0);
            case 'amount-desc':
                return b.DONATION - a.DONATION;
            case 'amount-asc':
                return a.DONATION - b.DONATION;
            case 'name-asc':
                return (a.NAME || '').localeCompare(b.NAME || '');
            case 'name-desc':
                return (b.NAME || '').localeCompare(a.NAME || '');
            default:
                return 0;
        }
    });
    
    updateDonorSearchResults();
    displayDonors();
}

// Update search results display
function updateDonorSearchResults() {
    const resultsElement = document.getElementById('donors-search-results');
    const total = allDonors.length;
    const filtered = filteredDonors.length;
    
    if (currentDonorSearchTerm || Object.values(currentFilters).some(v => v && v !== 'date-desc')) {
        resultsElement.textContent = `Showing ${filtered.toLocaleString()} of ${total.toLocaleString()} donors`;
    } else {
        resultsElement.textContent = `${total.toLocaleString()} total donors`;
    }
    
    // Update donors count
    document.getElementById('donors-count').textContent = 
        `${filtered.toLocaleString()} of ${total.toLocaleString()} donors`;
    
    // Update reset button state
    updateResetButtonState();
}

// Update reset button state based on active filters
function updateResetButtonState() {
    const resetBtn = document.getElementById('reset-filters');
    if (!resetBtn) return;
    
    const hasActiveFilters = currentDonorSearchTerm || 
        Object.values(currentFilters).some(v => v && v !== 'date-desc');
    
    resetBtn.disabled = !hasActiveFilters;
    
    if (hasActiveFilters) {
        resetBtn.textContent = '';
        resetBtn.innerHTML = `
            <span class="material-symbols-outlined">restart_alt</span>
            Reset Filters
        `;
    } else {
        resetBtn.textContent = '';
        resetBtn.innerHTML = `
            <span class="material-symbols-outlined">restart_alt</span>
            No Active Filters
        `;
    }
}

// Display donors
function displayDonors() {
    const container = document.getElementById('donors-container');
    const emptyState = document.getElementById('donors-empty-state');
    
    if (filteredDonors.length === 0) {
        container.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }
    
    container.style.display = 'block';
    emptyState.style.display = 'none';
    
    // Display first 50 donors (implement pagination later if needed)
    const donorsToShow = filteredDonors.slice(0, 50);
    
    container.innerHTML = donorsToShow.map(donor => createDonorCard(donor)).join('');
}

// Create donor card HTML
function createDonorCard(donor) {
    const borough = getBoroughName(donor.BOROUGHCD);
    const donationDate = donor.donationDate ? 
        donor.donationDate.toLocaleDateString() : 
        donor['DATE OF DONATION'] || 'Unknown';
    
    const searchHighlight = currentDonorSearchTerm ? 
        (text) => highlightSearchTerm(text || '', currentDonorSearchTerm) : 
        (text) => escapeHTML(text || '');
    
    return `
        <div class="donor-card">
            <div class="donor-header">
                <div>
                    <div class="donor-name">${searchHighlight(donor.NAME)}</div>
                    <div class="donor-location">
                        <span class="material-symbols-outlined">location_on</span>
                        ${searchHighlight(donor.CITY)}, ${donor.STATE} ${donor.ZIP}
                        ${borough ? ` (${borough})` : ''}
                    </div>
                </div>
                <div class="donor-amount">
                    ${formatCurrency(donor.DONATION)}
                    ${donor['MATCH-AMOUNT'] > 0 ? ` (+$${donor['MATCH-AMOUNT']} match)` : ''}
                </div>
            </div>
            
            <div class="donor-details">
                ${donor.EMPCITY ? `
                    <div class="donor-detail">
                        <div class="donor-detail-label">Employment</div>
                        <div class="donor-detail-value">${searchHighlight(donor.EMPCITY)}, ${donor.EMPSTATE}</div>
                    </div>
                ` : ''}
                
                <div class="donor-detail">
                    <div class="donor-detail-label">Payment Method</div>
                    <div class="donor-detail-value">${getPaymentMethod(donor.PAY_METHOD)}</div>
                </div>
                
                ${donor['PREVIOUS DONATION'] > 0 ? `
                    <div class="donor-detail">
                        <div class="donor-detail-label">Previous Donations</div>
                        <div class="donor-detail-value">$${donor['PREVIOUS DONATION']}</div>
                    </div>
                ` : ''}
            </div>
            
            <div class="donor-footer">
                <div class="donor-date">${donationDate}</div>
                ${donor.hasIntermediary ? `
                    <div class="donor-intermediary">
                        <span class="material-symbols-outlined">account_balance</span>
                        Via ${searchHighlight(donor.INTERMEDIARY_NAME)}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

// Get borough name from code
function getBoroughName(code) {
    const boroughs = {
        'M': 'Manhattan',
        'K': 'Brooklyn', 
        'Q': 'Queens',
        'X': 'Bronx',
        'R': 'Staten Island'
    };
    return boroughs[code] || '';
}

// Get payment method description
function getPaymentMethod(code) {
    const methods = {
        '1': 'Cash',
        '2': 'Check',
        '3': 'Credit Card',
        '4': 'Online/Electronic',
        '5': 'Money Order',
        '6': 'Other'
    };
    return methods[code] || 'Unknown';
}

// Reset all filters
function resetAllFilters() {
    // Clear search input
    const searchInput = document.getElementById('donors-search-input');
    if (searchInput) {
        searchInput.value = '';
    }
    
    // Reset all filter dropdowns to default values
    document.getElementById('amount-filter').value = '';
    document.getElementById('borough-filter').value = '';
    document.getElementById('intermediary-filter').value = '';
    document.getElementById('sort-filter').value = 'date-desc';
    
    // Clear current filter state
    currentDonorSearchTerm = '';
    currentFilters = {
        amount: '',
        borough: '',
        intermediary: '',
        sort: 'date-desc'
    };
    
    // Reapply filters (which will show all donors)
    applyDonorFilters();
    
    // Update reset button state
    updateResetButtonState();
}

// Show donor error
function showDonorError(message) {
    const container = document.getElementById('donors-container');
    container.innerHTML = `
        <div class="donors-empty-state" style="display: flex;">
            <span class="material-symbols-outlined">error</span>
            <h2>Error Loading Donors</h2>
            <p>${escapeHTML(message)}</p>
        </div>
    `;
}

// Start the application when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
