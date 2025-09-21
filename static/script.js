document.addEventListener('DOMContentLoaded', () => {
    const userInput = document.getElementById('userInput');
    const verifyBtn = document.getElementById('verifyBtn');
    const resultSection = document.getElementById('resultSection');
    const isCorrectSpan = document.getElementById('isCorrect');
    const confidenceSpan = document.getElementById('confidence');
    const reasoningSpan = document.getElementById('reasoning');
    const suggestionsSpan = document.getElementById('suggestions');
    const spinner = verifyBtn.querySelector('.spinner');
    const btnText = verifyBtn.querySelector('.btn-text');
    const toastContainer = document.getElementById('toastContainer');

    // Sidebar elements
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const mainContent = document.getElementById('mainContent');
    const chatHistoryList = document.getElementById('chatHistory');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');

    let verificationHistory = JSON.parse(localStorage.getItem('verificationHistory')) || [];
    let currentActiveHistoryItem = null;

    // --- Sidebar & History Functions ---
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        mainContent.classList.toggle('sidebar-open');
    });

    clearHistoryBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all history?')) {
            verificationHistory = [];
            localStorage.removeItem('verificationHistory');
            renderHistory();
            clearResultDisplay();
            showToast('History cleared!', 'success');
            currentActiveHistoryItem = null;
        }
    });

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.classList.add('toast', type);
        toast.textContent = message;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 4500);
    }

    function renderHistory() {
        chatHistoryList.innerHTML = '';
        if (verificationHistory.length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.style.cssText = 'padding: 15px; color: var(--text-secondary); text-align: center;';
            emptyItem.textContent = 'No history yet.';
            chatHistoryList.appendChild(emptyItem);
            return;
        }

        // Remove animations for performance with many items
        chatHistoryList.classList.add('rendering');
        
        verificationHistory.forEach((item, index) => {
            const li = document.createElement('li');
            li.dataset.index = index;
            if (currentActiveHistoryItem === index) {
                li.classList.add('active');
            }

            const inputDiv = document.createElement('div');
            inputDiv.classList.add('history-item-input');
            inputDiv.textContent = item.input.length > 50 ? item.input.substring(0, 47) + '...' : item.input;

            const statusDiv = document.createElement('div');
            statusDiv.classList.add('history-item-status');
            
            if (item.result && item.result.is_correct !== undefined) {
                statusDiv.textContent = item.result.is_correct ? 'Correct' : 'Incorrect';
                statusDiv.classList.add(item.result.is_correct ? 'correct' : 'incorrect');
            } else {
                statusDiv.textContent = 'Pending...';
                statusDiv.style.color = 'var(--warning-color)';
            }
            
            li.appendChild(inputDiv);
            li.appendChild(statusDiv);

            li.addEventListener('click', () => {
                displayHistoryItem(index);
                
                // Update active state
                document.querySelectorAll('#chatHistory li').forEach(item => {
                    item.classList.remove('active');
                });
                li.classList.add('active');
                currentActiveHistoryItem = index;
            });
            
            chatHistoryList.appendChild(li);
        });
        
        // Re-enable animations after rendering
        setTimeout(() => {
            chatHistoryList.classList.remove('rendering');
        }, 100);
    }

    function displayHistoryItem(index) {
        if (index < 0 || index >= verificationHistory.length) {
            showToast('Invalid history item.', 'error');
            return;
        }
        
        const item = verificationHistory[index];
        if (!item) {
            clearResultDisplay();
            showToast('History item not found.', 'error');
            return;
        }

        if (!item.result) {
            userInput.value = item.input;
            clearResultDisplay();
            resultSection.hidden = false;
            showToast('No detailed result for this history item yet.', 'info');
            return;
        }

        userInput.value = item.input;
        displayResult(item.result);
        resultSection.scrollIntoView({ behavior: 'smooth' });
    }

    function saveHistory(input, result) {
        const newItem = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            input: input,
            result: result
        };
        
        verificationHistory.unshift(newItem);
        if (verificationHistory.length > 20) {
            verificationHistory = verificationHistory.slice(0, 20);
        }
        
        localStorage.setItem('verificationHistory', JSON.stringify(verificationHistory));
        renderHistory();
        
        // Set as active
        currentActiveHistoryItem = 0;
        setTimeout(() => {
            const firstLi = chatHistoryList.querySelector('li');
            if (firstLi) {
                document.querySelectorAll('#chatHistory li').forEach(item => {
                    item.classList.remove('active');
                });
                firstLi.classList.add('active');
            }
        }, 50);
    }

    function clearResultDisplay() {
        isCorrectSpan.textContent = '';
        isCorrectSpan.className = ''; // Clear all classes
        confidenceSpan.textContent = '';
        reasoningSpan.textContent = '';
        suggestionsSpan.textContent = '';
        resultSection.hidden = true;
    }

    function displayResult(result) {
        if (!result) {
            clearResultDisplay();
            return;
        }
        
        isCorrectSpan.textContent = result.is_correct ? 'Yes' : 'No';
        isCorrectSpan.className = result.is_correct ? 'correct' : 'incorrect';
        confidenceSpan.textContent = result.confidence !== undefined ? `${result.confidence}%` : 'N/A';
        
        // Map the correct properties from Python response
        reasoningSpan.textContent = result.explanation || result.reasoning || 'No reasoning provided.';
        suggestionsSpan.textContent = result.is_correct ? 'None' : (result.correction || result.suggestions || 'No suggestions provided.');
        
        resultSection.hidden = false;
        resultSection.scrollIntoView({ behavior: 'smooth' });
    }

    // --- Verification Logic ---
    verifyBtn.addEventListener('click', async () => {
        const input = userInput.value.trim();
        if (!input) {
            showToast('Please enter text to verify.', 'warning');
            userInput.focus();
            return;
        }

        // Disable button and show spinner
        verifyBtn.disabled = true;
        btnText.hidden = true;
        spinner.hidden = false;
        clearResultDisplay();

        try {
            const response = await fetch('/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ input: input }), // Fixed: was 'user_input'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                if (data.result && data.result.is_correct !== undefined) {
                    displayResult(data.result);
                    saveHistory(input, data.result);
                } else {
                    showToast('Verification successful, but unexpected data format.', 'error');
                    console.error('Unexpected data format:', data);
                }
            } else {
                const errorMessage = data.error || 'Something went wrong.';
                showToast(`Error: ${errorMessage}`, 'error');
                console.error('Verification failed:', errorMessage);
                
                // Display error in result section for better UX
                resultSection.hidden = false;
                isCorrectSpan.textContent = 'Error';
                isCorrectSpan.className = 'incorrect';
                reasoningSpan.textContent = errorMessage;
                confidenceSpan.textContent = '0%';
                suggestionsSpan.textContent = 'Please try again or check your input.';
            }
        } catch (error) {
            showToast(`Network error: ${error.message}`, 'error');
            console.error('Fetch error:', error);
            
            // Display network error in UI
            resultSection.hidden = false;
            isCorrectSpan.textContent = 'Network Error';
            isCorrectSpan.className = 'incorrect';
            reasoningSpan.textContent = error.message;
            confidenceSpan.textContent = '0%';
            suggestionsSpan.textContent = 'Please check your internet connection and try again.';
        } finally {
            verifyBtn.disabled = false;
            btnText.hidden = false;
            spinner.hidden = true;
        }
    });

    // Allow Ctrl+Enter to submit
    userInput.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault(); // Prevent newline insertion
            verifyBtn.click();
        }
    });

    // Add escape key to close sidebar
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            mainContent.classList.remove('sidebar-open');
        }
    });

    // Initial render
    renderHistory();
});
