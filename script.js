'use strict';

// ===== DOM ELEMENTS =====
const container = document.getElementById('posts-container');
const loading = document.getElementById('loading');
const emptyState = document.getElementById('empty-state');
const postCountElement = document.getElementById('post-count');
const searchSection = document.getElementById('search-section');
const searchInput = document.getElementById('search-input');
const clearButton = document.getElementById('clear-search');
const searchResults = document.getElementById('search-results');

const toggleDateFilter = document.getElementById('toggle-date-filter');
const dateFilterControls = document.getElementById('date-filter-controls');
const startDateInput = document.getElementById('start-date');
const endDateInput = document.getElementById('end-date');
const applyDateFilterButton = document.getElementById('apply-date-filter');
const clearDateFilterButton = document.getElementById('clear-date-filter');
const datePresets = document.getElementById('date-presets');

// ===== STATE =====
const POSTS_PER_PAGE = 25;
let allPosts = [];
let filteredPosts = [];
let currentSearchTerm = '';
let currentTerms = [];
let currentStartDate = null;
let currentEndDate = null;
let observer = null;
let currentPage = 0;

// ===== TEXT HELPERS =====

// Function words only. Content words such as "work", "public", "new" or "right"
// must stay searchable on a politics archive.
const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he', 'in', 'is', 'it',
    'its', 'of', 'on', 'that', 'the', 'to', 'was', 'will', 'with', 'would', 'i', 'you', 'we', 'they',
    'she', 'her', 'him', 'his', 'my', 'our', 'your', 'their', 'this', 'these', 'those', 'but', 'or',
    'can', 'do', 'have', 'had', 'been', 'were', 'am', 'if', 'so', 'there', 'here', 'then', 'than',
    'just', 'also', 'very'
]);

const STEMMING_RULES = [
    [/ies$/, 'y'],
    [/ied$/, 'y'],
    [/(ss|s|x|z|ch|sh)es$/, '$1'],  // buses -> bus, taxes -> tax, houses -> hous
    [/ying$/, 'y'],
    [/ing$/, ''],
    [/ly$/, ''],
    [/ed$/, ''],
    [/s$/, '']
];

// Letters and digits in any script. Punctuation, @ and # separate words.
const WORD_RE = /[\p{L}\p{N}]+/gu;

// Links, @mentions and #hashtags in post text. The URL must not end in
// punctuation, so "https://t.co/abc!" links only "https://t.co/abc".
const ENTITY_RE = /(https?:\/\/\S*[^\s.,!?;:)\]"'”’…])|(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{1,15})|(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)/gu;

function normalizeText(text) {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function tokenize(text) {
    return normalizeText(text).match(WORD_RE) || [];
}

function stemWord(word) {
    if (word.length <= 3) return word;
    for (const [pattern, replacement] of STEMMING_RULES) {
        if (pattern.test(word)) {
            const stemmed = word.replace(pattern, replacement);
            if (stemmed.length >= 2) return stemmed;
        }
    }
    return word;
}

// Turn a query into search terms. Stopwords are dropped unless the query is
// nothing but stopwords, so searching "the" still searches.
function processSearchTerms(searchText) {
    if (!searchText || typeof searchText !== 'string') return [];
    const words = [...new Set(tokenize(searchText))];
    const meaningful = words.filter(word => !STOPWORDS.has(word));
    return (meaningful.length ? meaningful : words).map(word => ({
        original: word,
        stemmed: stemWord(word)
    }));
}

// A term matches a word if it is the word, the start of the word ("child" ->
// "childcare"), or shares its stem ("buses" -> "bus"). Prefix matching only
// runs one way: "therapy" must not match every post containing "the".
function termMatchesWord(term, word, stem) {
    if (word === term.original) return true;
    if (term.original.length >= 3 && word.startsWith(term.original)) return true;
    return stem === term.stemmed;
}

function postMatchesTerms(post, terms) {
    return terms.every(term =>
        post._words.some((word, i) => termMatchesWord(term, word, post._stems[i]))
    );
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHTML(str) {
    if (typeof str !== 'string') str = str == null ? '' : String(str);
    return str.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

function decodeNumericEntity(match, digits, radix) {
    const codePoint = parseInt(digits, radix);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) return match;
    return String.fromCodePoint(codePoint);
}

function decodeHTMLEntitiesOnce(str) {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => decodeNumericEntity(match, hex, 16))
        .replace(/&#(\d+);/g, (match, num) => decodeNumericEntity(match, num, 10));
}

// Archived post text can be HTML-escaped more than once (e.g. &amp;amp;).
function decodeHTMLEntities(str) {
    if (typeof str !== 'string' || str.length === 0) return '';
    let decoded = str;
    for (let i = 0; i < 5; i++) {
        const next = decodeHTMLEntitiesOnce(decoded);
        if (next === decoded) break;
        decoded = next;
    }
    return decoded;
}

// ===== HIGHLIGHTING =====

function mergeRanges(ranges) {
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged = [];
    for (const range of sorted) {
        const last = merged[merged.length - 1];
        if (last && range.start <= last.end) {
            last.end = Math.max(last.end, range.end);
        } else {
            merged.push({ start: range.start, end: range.end });
        }
    }
    return merged;
}

// Ranges of whole words in the original text that match the search terms.
function findWordHighlights(text, terms) {
    if (!text || !terms.length) return [];
    const ranges = [];
    for (const match of text.matchAll(WORD_RE)) {
        const word = normalizeText(match[0]);
        const stem = stemWord(word);
        if (terms.some(term => termMatchesWord(term, word, stem))) {
            ranges.push({ start: match.index, end: match.index + match[0].length });
        }
    }
    return mergeRanges(ranges);
}

// Ranges of substrings that match the terms (used for donor search, which
// matches substrings such as "son" in "Johnson").
function findSubstringHighlights(text, terms) {
    if (!text || !terms.length) return [];
    const normalized = normalizeText(text);
    // Accent stripping can change length for unusual characters; fall back
    // to plain lowercasing so indices stay aligned with the original text.
    const haystack = normalized.length === text.length ? normalized : text.toLowerCase();
    const ranges = [];
    for (const term of terms) {
        let index = 0;
        while ((index = haystack.indexOf(term.original, index)) !== -1) {
            ranges.push({ start: index, end: index + term.original.length });
            index += term.original.length;
        }
    }
    return mergeRanges(ranges);
}

// Escape text[start, end) and wrap the parts covered by ranges in <mark>.
function highlightSlice(text, start, end, ranges) {
    let html = '';
    let cursor = start;
    for (const range of ranges) {
        if (range.end <= start || range.start >= end) continue;
        const s = Math.max(range.start, cursor);
        const e = Math.min(range.end, end);
        if (s >= e) continue;
        html += escapeHTML(text.slice(cursor, s)) + '<mark>' + escapeHTML(text.slice(s, e)) + '</mark>';
        cursor = e;
    }
    return html + escapeHTML(text.slice(cursor, end));
}

function highlightText(text, ranges) {
    return highlightSlice(text || '', 0, (text || '').length, ranges);
}

// Post text as HTML: escaped, search matches highlighted, and links,
// @mentions and #hashtags turned into links to X.
function renderPostText(text, ranges) {
    let html = '';
    let cursor = 0;
    for (const match of text.matchAll(ENTITY_RE)) {
        let start = match.index;
        let href;
        if (match[1]) {
            href = match[1];
        } else if (match[3]) {
            start += match[2].length;
            href = `https://x.com/${match[3]}`;
        } else {
            start += match[4].length;
            href = `https://x.com/hashtag/${encodeURIComponent(match[5])}`;
        }
        const end = match.index + match[0].length;
        html += highlightSlice(text, cursor, start, ranges);
        html += `<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${highlightSlice(text, start, end, ranges)}</a>`;
        cursor = end;
    }
    return html + highlightSlice(text, cursor, text.length, ranges);
}

// ===== DATES =====

// Post timestamps look like "6/28/2025 10:56" (US Eastern).
function parsePostDate(dateString) {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(dateString || '');
    if (!match) return null;
    const [, month, day, year, hour = '0', minute = '0'] = match;
    return new Date(+year, +month - 1, +day, +hour, +minute);
}

// <input type="date"> values are "YYYY-MM-DD". new Date("YYYY-MM-DD") reads
// that as UTC midnight, which is the previous evening in US time zones, so
// build the date in local time instead.
function parseInputDate(value, endOfDay = false) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const [, year, month, day] = match.map(Number);
    return endOfDay
        ? new Date(year, month - 1, day, 23, 59, 59, 999)
        : new Date(year, month - 1, day);
}

function toInputValue(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatShortDate(date) {
    return date ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown date';
}

function formatFullDate(date) {
    if (!date) return 'Unknown date';
    return date.toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
    }) + ' ET';
}

function formatDateRange(startDate, endDate) {
    if (startDate && endDate) return `${formatShortDate(startDate)} to ${formatShortDate(endDate)}`;
    if (startDate) return `${formatShortDate(startDate)} onwards`;
    if (endDate) return `up to ${formatShortDate(endDate)}`;
    return '';
}

// ===== POSTS: LOADING AND RENDERING =====

async function loadPosts() {
    try {
        const response = await fetch('ZohranKMamdani_X_posts.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const posts = await response.json();

        allPosts = posts
            .filter(post => post.text && post.text.trim() !== '')
            .map(post => {
                const text = decodeHTMLEntities(post.text);
                const words = [...new Set(tokenize(text))];
                return {
                    ...post,
                    text,
                    date: parsePostDate(post.created_at),
                    _words: words,
                    _stems: words.map(stemWord)
                };
            });
        filteredPosts = allPosts;

        loading.style.display = 'none';

        if (allPosts.length === 0) {
            emptyState.style.display = 'flex';
            postCountElement.textContent = '0 posts';
            return;
        }

        searchSection.style.display = 'block';
        container.style.display = 'block';
        buildYearPresets();
        refreshPosts();
    } catch (error) {
        console.error('Error loading posts:', error);
        showError(error.message);
    }
}

function setupIntersectionObserver() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                observer.unobserve(entry.target);
                loadMorePosts();
            }
        }
    }, { rootMargin: '600px 0px' });
}

// Clear the list and render the first page of filteredPosts.
function renderPosts() {
    container.innerHTML = '';
    currentPage = 0;
    setupIntersectionObserver();

    if (filteredPosts.length === 0) {
        showNoResults();
        return;
    }
    loadMorePosts();
}

// Append the next page. Rendering is synchronous so a newer search can never
// be overwritten by a page queued for an older one.
function loadMorePosts() {
    const start = currentPage * POSTS_PER_PAGE;
    const batch = filteredPosts.slice(start, start + POSTS_PER_PAGE);
    if (batch.length === 0) return;

    const fragment = document.createDocumentFragment();
    batch.forEach(post => fragment.appendChild(createPostElement(post)));
    container.appendChild(fragment);
    currentPage++;

    if (currentPage * POSTS_PER_PAGE < filteredPosts.length && container.lastElementChild) {
        observer.observe(container.lastElementChild);
    }
}

const POST_TYPE_ICONS = { Reply: 'reply', Repost: 'repeat', Post: 'edit_note' };

function createPostElement(post) {
    const article = document.createElement('article');
    article.className = 'post';

    const postLink = post.link || '';
    const postType = POST_TYPE_ICONS[post.type] ? post.type : 'Post';
    const ranges = findWordHighlights(post.text, currentTerms);
    const safeLink = escapeHTML(postLink || '#');

    article.innerHTML = `
        <div class="post-avatar">
            <img src="profile.jpg" alt="" width="40" height="40" loading="lazy" decoding="async" />
        </div>
        <div class="post-content">
            <div class="meta">
                <span class="handle">ZohranKMamdani</span>
                <span class="separator" aria-hidden="true"></span>
                <a href="${safeLink}" target="_blank" rel="noopener noreferrer" class="date" title="${escapeHTML(formatFullDate(post.date))}">${escapeHTML(formatShortDate(post.date))}</a>
                <span class="separator" aria-hidden="true"></span>
                <span class="post-type type-${postType.toLowerCase()}" title="${postType}">
                    <span class="material-symbols-outlined" aria-hidden="true">${POST_TYPE_ICONS[postType]}</span>
                    <span class="post-type-label">${postType}</span>
                </span>
                <a href="${safeLink}" target="_blank" rel="noopener noreferrer" class="post-link-inline" title="View post on X" aria-label="View post on X">
                    <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
                </a>
            </div>
            <div class="text">${renderPostText(post.text, ranges)}</div>
        </div>
    `;

    // The whole card opens the post, except links, and except when the
    // reader is selecting text to copy it.
    article.addEventListener('click', event => {
        if (event.target.closest('a, button')) return;
        if (String(window.getSelection() || '').length > 0) return;
        if (postLink) window.open(postLink, '_blank', 'noopener,noreferrer');
    });

    return article;
}

function showNoResults() {
    const hasSearch = !!currentSearchTerm;
    const hasDate = !!(currentStartDate || currentEndDate);
    const what = hasSearch && hasDate ? 'search and date filter'
        : hasSearch ? 'search' : 'date filter';

    const wrapper = document.createElement('div');
    wrapper.className = 'no-results';
    wrapper.innerHTML = `
        <span class="material-symbols-outlined" aria-hidden="true">search_off</span>
        <h3>No posts found</h3>
        <p>Try different words or dates, or <button type="button" class="link-button">clear the ${what}</button>.</p>
    `;
    wrapper.querySelector('button').addEventListener('click', clearAllPostFilters);
    container.appendChild(wrapper);
}

function showError(message) {
    loading.style.display = 'none';
    container.innerHTML = `
        <div class="error-state">
            <span class="material-symbols-outlined" aria-hidden="true">error</span>
            <h2>Failed to Load Posts</h2>
            <p>There was an issue fetching the posts. Please try again later.</p>
            <small>Error: ${escapeHTML(message)}</small>
        </div>
    `;
    container.style.display = 'block';
}

// ===== POSTS: FILTERING =====

function hasActivePostFilters() {
    return !!(currentSearchTerm || currentStartDate || currentEndDate);
}

function applyFilters() {
    let filtered = allPosts;
    if (currentTerms.length) {
        filtered = filtered.filter(post => postMatchesTerms(post, currentTerms));
    }
    if (currentStartDate || currentEndDate) {
        filtered = filtered.filter(post => {
            if (!post.date) return false;
            if (currentStartDate && post.date < currentStartDate) return false;
            if (currentEndDate && post.date > currentEndDate) return false;
            return true;
        });
    }
    filteredPosts = filtered;
}

// Single entry point after any search or date change.
function refreshPosts() {
    applyFilters();
    updatePostCount();
    updateResultsSummary();
    renderPosts();
}

function updatePostCount() {
    const total = allPosts.length.toLocaleString();
    postCountElement.textContent = hasActivePostFilters()
        ? `${filteredPosts.length.toLocaleString()} of ${total} posts`
        : `${total} posts`;
}

function updateResultsSummary() {
    const count = filteredPosts.length.toLocaleString();
    const hasDate = !!(currentStartDate || currentEndDate);
    const dateText = hasDate ? escapeHTML(formatDateRange(currentStartDate, currentEndDate)) : '';
    let html = '';

    if (currentSearchTerm) {
        const query = `"<strong>${escapeHTML(currentSearchTerm)}</strong>"`;
        html = filteredPosts.length
            ? `Found ${count} ${filteredPosts.length === 1 ? 'post' : 'posts'} matching ${query}`
            : `No posts match ${query}`;
        if (hasDate) html += ` <span class="muted">from ${dateText}</span>`;

        const typedWords = tokenize(currentSearchTerm);
        if (currentTerms.length && currentTerms.length < new Set(typedWords).size) {
            html += `<br><span class="muted">Searching for: ${currentTerms.map(t => `"${escapeHTML(t.original)}"`).join(', ')}</span>`;
        }
    } else if (hasDate) {
        html = `${count} ${filteredPosts.length === 1 ? 'post' : 'posts'} from ${dateText}`;
    }

    searchResults.innerHTML = html;
}

// ===== POSTS: SEARCH UI =====

function initializeSearch() {
    searchInput.addEventListener('input', debounce(handleSearch, 250));
    searchInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleSearch();
        } else if (event.key === 'Escape' && searchInput.value) {
            clearSearch();
        }
    });
    clearButton.addEventListener('click', () => {
        clearSearch();
        searchInput.focus();
    });

    const helpButton = document.getElementById('search-help');
    const helpPanel = document.getElementById('search-help-panel');
    const setHelpOpen = open => {
        helpPanel.classList.toggle('show', open);
        helpButton.setAttribute('aria-expanded', String(open));
    };
    helpButton.addEventListener('click', event => {
        event.stopPropagation();
        setHelpOpen(!helpPanel.classList.contains('show'));
    });
    document.addEventListener('click', event => {
        if (!helpPanel.contains(event.target) && !helpButton.contains(event.target)) setHelpOpen(false);
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') setHelpOpen(false);
    });
    searchInput.addEventListener('focus', () => setHelpOpen(false));
}

function handleSearch() {
    const searchTerm = searchInput.value.trim();
    clearButton.style.display = searchTerm ? 'flex' : 'none';
    // Enter and the debounced input handler both call this; skip the repeat.
    if (searchTerm === currentSearchTerm) return;
    currentSearchTerm = searchTerm;
    currentTerms = processSearchTerms(searchTerm);
    refreshPosts();
}

function clearSearch() {
    searchInput.value = '';
    handleSearch();
}

function clearAllPostFilters() {
    searchInput.value = '';
    clearButton.style.display = 'none';
    currentSearchTerm = '';
    currentTerms = [];
    resetDateInputs();
    refreshPosts();
}

// ===== POSTS: DATE FILTER UI =====

function initializeDateFilter() {
    toggleDateFilter.addEventListener('click', () => {
        const expanded = dateFilterControls.classList.toggle('expanded');
        toggleDateFilter.classList.toggle('expanded', expanded);
        toggleDateFilter.setAttribute('aria-expanded', String(expanded));
    });

    applyDateFilterButton.addEventListener('click', handleDateFilter);
    clearDateFilterButton.addEventListener('click', () => {
        resetDateInputs();
        refreshPosts();
    });

    [startDateInput, endDateInput].forEach(input => {
        input.addEventListener('change', () => {
            startDateInput.setCustomValidity('');
            endDateInput.setCustomValidity('');
        });
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') handleDateFilter();
        });
    });
}

// One button per year in the archive, newest first. Fixed "last 7 days"
// presets would always be empty because the archive ends in July 2025.
function buildYearPresets() {
    const years = [...new Set(allPosts.map(post => post.date && post.date.getFullYear()).filter(Boolean))]
        .sort((a, b) => b - a);
    datePresets.innerHTML = '';
    for (const year of years) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'preset-btn';
        button.dataset.year = year;
        button.textContent = year;
        button.addEventListener('click', () => {
            startDateInput.value = `${year}-01-01`;
            endDateInput.value = `${year}-12-31`;
            handleDateFilter();
        });
        datePresets.appendChild(button);
    }
}

function markActiveYear() {
    const start = startDateInput.value;
    const end = endDateInput.value;
    datePresets.querySelectorAll('.preset-btn').forEach(button => {
        const year = button.dataset.year;
        button.classList.toggle('active', start === `${year}-01-01` && end === `${year}-12-31`);
    });
}

function handleDateFilter() {
    const start = parseInputDate(startDateInput.value);
    const end = parseInputDate(endDateInput.value, true);

    if (start && end && start > end) {
        endDateInput.setCustomValidity('The end date must be on or after the start date.');
        endDateInput.reportValidity();
        return;
    }

    currentStartDate = start;
    currentEndDate = end;
    markActiveYear();
    refreshPosts();
}

function resetDateInputs() {
    startDateInput.value = '';
    endDateInput.value = '';
    startDateInput.setCustomValidity('');
    endDateInput.setCustomValidity('');
    currentStartDate = null;
    currentEndDate = null;
    markActiveYear();
}

// ===== GENERAL UI =====

function debounce(func, wait) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

function updateSearchPlaceholder() {
    const mobile = window.innerWidth <= 768;
    searchInput.placeholder = mobile
        ? 'Search posts...'
        : "Search posts (try: 'rent freeze', 'childcare', 'buses')...";
    document.getElementById('donors-search-input').placeholder = mobile
        ? 'Search donors...'
        : 'Search by name, city, ZIP or intermediary...';
}

function showTab(targetTab) {
    document.querySelectorAll('.nav-link').forEach(link => {
        const active = link.dataset.tab === targetTab;
        link.classList.toggle('active', active);
        link.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.hidden = tab.id !== `${targetTab}-tab`;
    });
    if (targetTab === 'donors' && allDonors.length === 0 && !donorsLoading) {
        loadDonorData();
    }
}

function initializeTabSwitching() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', event => {
            event.preventDefault();
            const tab = link.dataset.tab;
            showTab(tab);
            // Keep the tab in the URL so it survives a refresh and can be shared.
            history.replaceState(null, '', `#${tab}`);
        });
    });
    window.addEventListener('hashchange', () => {
        showTab(location.hash === '#donors' ? 'donors' : 'posts');
    });
}

function init() {
    initializeSearch();
    initializeDateFilter();
    updateSearchPlaceholder();
    initializeTabSwitching();
    initializeDonorDatabase();
    window.addEventListener('resize', debounce(updateSearchPlaceholder, 150));
    loadPosts();
    showTab(location.hash === '#donors' ? 'donors' : 'posts');
}

// ===== DONOR DATABASE =====

const DONORS_PER_PAGE = 50;
let allDonors = [];
let filteredDonors = [];
let donorsShown = 0;
let donorsLoading = false;
let currentDonorSearchTerm = '';
let currentDonorTerms = [];
const DEFAULT_DONOR_FILTERS = { amount: '', borough: '', intermediary: '', sort: 'date-desc' };
let currentFilters = { ...DEFAULT_DONOR_FILTERS };

const BOROUGHS = { M: 'Manhattan', K: 'Brooklyn', Q: 'Queens', X: 'Bronx', R: 'Staten Island' };
const PAYMENT_METHODS = {
    '1': 'Cash', '2': 'Check', '3': 'Credit Card',
    '4': 'Online/Electronic', '5': 'Money Order', '6': 'Other'
};

function initializeDonorDatabase() {
    const donorSearchInput = document.getElementById('donors-search-input');
    const clearDonorSearch = document.getElementById('clear-donors-search');

    donorSearchInput.addEventListener('input', debounce(handleDonorSearch, 250));
    clearDonorSearch.addEventListener('click', () => {
        donorSearchInput.value = '';
        handleDonorSearch();
        donorSearchInput.focus();
    });

    ['amount-filter', 'borough-filter', 'intermediary-filter', 'sort-filter'].forEach(id => {
        document.getElementById(id).addEventListener('change', handleDonorFilters);
    });
    document.getElementById('reset-filters').addEventListener('click', resetAllFilters);
    document.getElementById('donors-load-more').addEventListener('click', showMoreDonors);

    initializeFiltersToggle();
}

function initializeFiltersToggle() {
    const toggleButton = document.getElementById('toggle-donor-filters');
    const filtersContainer = document.getElementById('donors-filters-container');
    const isMobile = () => window.innerWidth <= 768;

    const setExpanded = expanded => {
        toggleButton.classList.toggle('expanded', expanded);
        toggleButton.setAttribute('aria-expanded', String(expanded));
        filtersContainer.classList.toggle('expanded', expanded);
        filtersContainer.classList.toggle('collapsed', !expanded);
    };

    toggleButton.addEventListener('click', () => {
        setExpanded(!toggleButton.classList.contains('expanded'));
    });

    // Filters are always visible on desktop and collapsible on mobile.
    let wasMobile = isMobile();
    setExpanded(!wasMobile);
    window.addEventListener('resize', debounce(() => {
        const mobile = isMobile();
        if (mobile !== wasMobile) setExpanded(!mobile);
        wasMobile = mobile;
    }, 150));
}

async function loadDonorData() {
    const donorLoading = document.getElementById('donors-loading');
    const donorContainer = document.getElementById('donors-container');
    donorsLoading = true;

    try {
        donorLoading.style.display = 'flex';
        donorContainer.style.display = 'none';

        const response = await fetch('zohran-donor.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const donors = await response.json();

        allDonors = donors.map((donor, index) => {
            const amount = parseFloat(donor.DONATION) || 0;
            const intermediary = (donor.INTERMEDIARY_NAME || '').trim();
            return {
                ...donor,
                id: index,
                DONATION: amount,
                'MATCH-AMOUNT': parseFloat(donor['MATCH-AMOUNT']) || 0,
                'PREVIOUS DONATION': parseFloat(donor['PREVIOUS DONATION']) || 0,
                donationDate: parseDonorDate(donor['DATE OF DONATION']),
                hasIntermediary: !!intermediary,
                isRefund: amount < 0,
                _search: normalizeText([
                    donor.NAME, donor.CITY, donor.STATE, donor.ZIP, donor.EMPCITY,
                    donor.EMPSTATE, intermediary, donor.INTERMEDIARY_EMP_NAME
                ].filter(Boolean).join(' '))
            };
        });

        updateDonorAnalytics();
        applyDonorFilters();
    } catch (error) {
        console.error('Error loading donor data:', error);
        showDonorError('Failed to load donor data. Please try again later.');
    } finally {
        donorsLoading = false;
        donorLoading.style.display = 'none';
    }
}

function parseDonorDate(dateString) {
    if (!dateString) return null;
    let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateString);
    if (match) return new Date(+match[3], match[1] - 1, +match[2]);
    match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
    if (match) return new Date(+match[1], match[2] - 1, +match[3]);
    const parsed = new Date(dateString);
    return isNaN(parsed.getTime()) ? null : parsed;
}

function formatCurrency(amount, { cents = false } = {}) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: cents ? 2 : 0
    }).format(amount);
}

// Refunds are recorded as separate negative rows with no intermediary, so the
// headline figures use gross contributions and show refunds alongside.
function updateDonorAnalytics() {
    const contributions = allDonors.filter(donor => donor.DONATION > 0);
    const gross = contributions.reduce((sum, donor) => sum + donor.DONATION, 0);
    const refunds = allDonors.reduce((sum, donor) => sum + (donor.isRefund ? donor.DONATION : 0), 0);
    const viaIntermediary = contributions
        .filter(donor => donor.hasIntermediary)
        .reduce((sum, donor) => sum + donor.DONATION, 0);
    // Approximation: the data has no donor ID, so count distinct name + ZIP.
    const uniqueDonors = new Set(contributions.map(donor => `${donor.NAME}|${donor.ZIP}`)).size;

    const set = (id, text) => { document.getElementById(id).textContent = text; };
    set('total-donations', formatCurrency(gross));
    set('total-refunds', refunds < 0 ? `${formatCurrency(-refunds)} refunded` : '');
    set('total-donors', contributions.length.toLocaleString());
    set('unique-donors', `About ${uniqueDonors.toLocaleString()} unique donors`);
    set('intermediary-donations', formatCurrency(viaIntermediary));
    // Floor so 99.99% never displays as 100%.
    const share = gross > 0 ? Math.floor((viaIntermediary / gross) * 1000) / 10 : 0;
    set('intermediary-share', gross > 0 ? `${share}% of total raised` : '');
    set('average-donation', formatCurrency(contributions.length ? gross / contributions.length : 0, { cents: true }));
}

function handleDonorSearch() {
    currentDonorSearchTerm = document.getElementById('donors-search-input').value.trim();
    currentDonorTerms = processSearchTerms(currentDonorSearchTerm);
    document.getElementById('clear-donors-search').style.display = currentDonorSearchTerm ? 'flex' : 'none';
    applyDonorFilters();
}

function handleDonorFilters() {
    currentFilters = {
        amount: document.getElementById('amount-filter').value,
        borough: document.getElementById('borough-filter').value,
        intermediary: document.getElementById('intermediary-filter').value,
        sort: document.getElementById('sort-filter').value
    };
    applyDonorFilters();
}

function matchesAmount(amount, range) {
    switch (range) {
        case '0-25': return amount > 0 && amount <= 25;
        case '25-100': return amount > 25 && amount <= 100;
        case '100-500': return amount > 100 && amount <= 500;
        case '500+': return amount > 500;
        case 'refund': return amount < 0;
        default: return true;
    }
}

const DONOR_SORTS = {
    'date-desc': (a, b) => (b.donationDate || 0) - (a.donationDate || 0),
    'date-asc': (a, b) => (a.donationDate || 0) - (b.donationDate || 0),
    'amount-desc': (a, b) => b.DONATION - a.DONATION,
    'amount-asc': (a, b) => a.DONATION - b.DONATION,
    'name-asc': (a, b) => (a.NAME || '').localeCompare(b.NAME || ''),
    'name-desc': (a, b) => (b.NAME || '').localeCompare(a.NAME || '')
};

function applyDonorFilters() {
    if (!allDonors.length) return;
    const { amount, borough, intermediary, sort } = currentFilters;

    filteredDonors = allDonors.filter(donor => {
        if (currentDonorTerms.length && !currentDonorTerms.every(term => donor._search.includes(term.original))) return false;
        if (amount && !matchesAmount(donor.DONATION, amount)) return false;
        if (borough && donor.BOROUGHCD !== borough) return false;
        if (intermediary === 'yes' && !donor.hasIntermediary) return false;
        if (intermediary === 'no' && donor.hasIntermediary) return false;
        return true;
    });
    filteredDonors.sort(DONOR_SORTS[sort] || DONOR_SORTS['date-desc']);

    donorsShown = 0;
    document.getElementById('donors-container').innerHTML = '';
    showMoreDonors();
    updateDonorCounts();
}

function hasActiveDonorFilters() {
    return !!currentDonorSearchTerm ||
        Object.keys(DEFAULT_DONOR_FILTERS).some(key => currentFilters[key] !== DEFAULT_DONOR_FILTERS[key]);
}

function updateDonorCounts() {
    const total = allDonors.length.toLocaleString();
    const filtered = filteredDonors.length.toLocaleString();
    const shown = Math.min(donorsShown, filteredDonors.length).toLocaleString();

    document.getElementById('donors-count').textContent = hasActiveDonorFilters()
        ? `${filtered} of ${total} contributions match`
        : `${total} contributions`;
    document.getElementById('donors-search-results').textContent = filteredDonors.length
        ? `Showing ${shown} of ${filtered}`
        : '';
    document.getElementById('reset-filters').disabled = !hasActiveDonorFilters();
}

function showMoreDonors() {
    const donorContainer = document.getElementById('donors-container');
    const emptyStateEl = document.getElementById('donors-empty-state');
    const more = document.getElementById('donors-more');

    if (filteredDonors.length === 0) {
        donorContainer.style.display = 'none';
        emptyStateEl.hidden = false;
        more.hidden = true;
        return;
    }

    donorContainer.style.display = 'block';
    emptyStateEl.hidden = true;

    const next = filteredDonors.slice(donorsShown, donorsShown + DONORS_PER_PAGE);
    donorContainer.insertAdjacentHTML('beforeend', next.map(createDonorCard).join(''));
    donorsShown += next.length;

    const remaining = filteredDonors.length - donorsShown;
    more.hidden = remaining <= 0;
    document.getElementById('donors-load-more').textContent =
        `Show ${Math.min(remaining, DONORS_PER_PAGE).toLocaleString()} more (${remaining.toLocaleString()} remaining)`;
    updateDonorCounts();
}

function createDonorCard(donor) {
    const highlight = text => highlightText(text || '', findSubstringHighlights(text || '', currentDonorTerms));
    const borough = BOROUGHS[donor.BOROUGHCD] || '';
    const donationDate = donor.donationDate
        ? donor.donationDate.toLocaleDateString('en-US')
        : (donor['DATE OF DONATION'] || 'Unknown date');
    const location = [donor.CITY && highlight(donor.CITY), [donor.STATE, donor.ZIP].filter(Boolean).map(v => highlight(v)).join(' ')]
        .filter(Boolean).join(', ');
    const employer = [donor.EMPCITY, donor.EMPSTATE].filter(Boolean).map(v => highlight(v)).join(', ');

    return `
        <div class="donor-card${donor.isRefund ? ' is-refund' : ''}">
            <div class="donor-header">
                <div>
                    <div class="donor-name">${highlight(donor.NAME)}</div>
                    <div class="donor-location">
                        <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
                        <span>${location || 'Unknown location'}${borough ? ` (${borough})` : ''}</span>
                    </div>
                </div>
                <div class="donor-amount">
                    ${donor.isRefund ? '<span class="refund-tag"><span class="material-symbols-outlined" aria-hidden="true">undo</span>Refund</span>' : ''}
                    ${formatCurrency(donor.DONATION, { cents: true })}
                    ${donor['MATCH-AMOUNT'] > 0 ? `<span class="donor-match">+${formatCurrency(donor['MATCH-AMOUNT'], { cents: true })} match</span>` : ''}
                </div>
            </div>

            <div class="donor-details">
                ${employer ? `
                    <div class="donor-detail">
                        <div class="donor-detail-label">Employer location</div>
                        <div class="donor-detail-value">${employer}</div>
                    </div>
                ` : ''}
                <div class="donor-detail">
                    <div class="donor-detail-label">Payment method</div>
                    <div class="donor-detail-value">${PAYMENT_METHODS[donor.PAY_METHOD] || 'Unknown'}</div>
                </div>
                ${donor['PREVIOUS DONATION'] > 0 ? `
                    <div class="donor-detail">
                        <div class="donor-detail-label">Previous donations</div>
                        <div class="donor-detail-value">${formatCurrency(donor['PREVIOUS DONATION'], { cents: true })}</div>
                    </div>
                ` : ''}
            </div>

            <div class="donor-footer">
                <div class="donor-date">${escapeHTML(donationDate)}${donor.isRefund && donor['REFUND DATE'] ? ` · refunded ${escapeHTML(donor['REFUND DATE'])}` : ''}</div>
                ${donor.hasIntermediary ? `
                    <div class="donor-intermediary">
                        <span class="material-symbols-outlined" aria-hidden="true">account_balance</span>
                        <span>Via ${highlight(donor.INTERMEDIARY_NAME)}${donor.INTERMEDIARY_EMP_NAME ? ` (${highlight(donor.INTERMEDIARY_EMP_NAME)})` : ''}</span>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

function resetAllFilters() {
    document.getElementById('donors-search-input').value = '';
    document.getElementById('clear-donors-search').style.display = 'none';
    document.getElementById('amount-filter').value = DEFAULT_DONOR_FILTERS.amount;
    document.getElementById('borough-filter').value = DEFAULT_DONOR_FILTERS.borough;
    document.getElementById('intermediary-filter').value = DEFAULT_DONOR_FILTERS.intermediary;
    document.getElementById('sort-filter').value = DEFAULT_DONOR_FILTERS.sort;
    currentDonorSearchTerm = '';
    currentDonorTerms = [];
    currentFilters = { ...DEFAULT_DONOR_FILTERS };
    applyDonorFilters();
}

function showDonorError(message) {
    const donorContainer = document.getElementById('donors-container');
    donorContainer.style.display = 'block';
    donorContainer.innerHTML = `
        <div class="donors-empty-state">
            <span class="material-symbols-outlined" aria-hidden="true">error</span>
            <h2>Error Loading Donors</h2>
            <p>${escapeHTML(message)}</p>
        </div>
    `;
    document.getElementById('donors-count').textContent = 'Unavailable';
}

// Start the application when the DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
