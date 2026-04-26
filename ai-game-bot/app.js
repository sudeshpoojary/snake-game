const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const BLOCK_SIZE = 20;
const WIDTH = canvas.width;
const HEIGHT = canvas.height;
let SPEED = 15; // FPS

// Colors
const COLOR_BG = '#000000';
const COLOR_SNAKE_HEAD = '#3b82f6';
const COLOR_SNAKE_BODY = '#1e3a8a';
const COLOR_FOOD = '#f43f5e';

const Direction = {
    RIGHT: 1,
    LEFT: 2,
    UP: 3,
    DOWN: 4
};

// State
let snake = [];
let food = null;
let direction = Direction.RIGHT;
let score = 0;
let record = 0;
let gameOver = false;
let gameLoopId = null;

// UI Elements
const scoreEl = document.getElementById('score');
const recordEl = document.getElementById('record');
const finalScoreEl = document.getElementById('finalScore');
const overlayEl = document.getElementById('gameOverOverlay');
const restartBtn = document.getElementById('restartBtn');

// Mode Controls
const modeManualBtn = document.getElementById('modeManual');
const modeAIBtn = document.getElementById('modeAI');
const statsGrid = document.getElementById('statsGrid');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

let isAIMode = false;
let socket = null;

function initGame() {
    direction = Direction.RIGHT;
    snake = [
        {x: WIDTH/2, y: HEIGHT/2},
        {x: WIDTH/2 - BLOCK_SIZE, y: HEIGHT/2},
        {x: WIDTH/2 - 2*BLOCK_SIZE, y: HEIGHT/2}
    ];
    score = 0;
    gameOver = false;
    scoreEl.innerText = score;
    overlayEl.classList.add('hidden');
    placeFood();
}

function placeFood() {
    let newFood;
    while (true) {
        newFood = {
            x: Math.floor(Math.random() * (WIDTH/BLOCK_SIZE)) * BLOCK_SIZE,
            y: Math.floor(Math.random() * (HEIGHT/BLOCK_SIZE)) * BLOCK_SIZE
        };
        // Check if food is on snake
        let onSnake = snake.some(s => s.x === newFood.x && s.y === newFood.y);
        if (!onSnake) break;
    }
    food = newFood;
}

function drawRect(x, y, color, padding=0) {
    ctx.fillStyle = color;
    ctx.fillRect(x + padding, y + padding, BLOCK_SIZE - 2*padding, BLOCK_SIZE - 2*padding);
}

function draw() {
    // Clear canvas
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    
    // Draw grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for(let i=0; i<=WIDTH; i+=BLOCK_SIZE) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, HEIGHT); ctx.stroke();
    }
    for(let i=0; i<=HEIGHT; i+=BLOCK_SIZE) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(WIDTH, i); ctx.stroke();
    }

    // Draw snake
    snake.forEach((part, index) => {
        let color = index === 0 ? COLOR_SNAKE_HEAD : COLOR_SNAKE_BODY;
        drawRect(part.x, part.y, color);
        if(index === 0) {
            drawRect(part.x, part.y, '#60a5fa', 4); // Head highlight
        }
    });

    // Draw food
    if (food) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = COLOR_FOOD;
        drawRect(food.x, food.y, COLOR_FOOD);
        ctx.shadowBlur = 0;
    }
}

function move() {
    let head = { ...snake[0] };
    if (direction === Direction.RIGHT) head.x += BLOCK_SIZE;
    if (direction === Direction.LEFT) head.x -= BLOCK_SIZE;
    if (direction === Direction.UP) head.y -= BLOCK_SIZE;
    if (direction === Direction.DOWN) head.y += BLOCK_SIZE;
    return head;
}

function isCollision(pt) {
    if (pt.x >= WIDTH || pt.x < 0 || pt.y >= HEIGHT || pt.y < 0) return true;
    for (let i = 1; i < snake.length; i++) {
        if (pt.x === snake[i].x && pt.y === snake[i].y) return true;
    }
    return false;
}

function playStep() {
    let head = move();
    snake.unshift(head);

    if (isCollision(head)) {
        gameOver = true;
        handleGameOver();
        return;
    }

    if (head.x === food.x && head.y === food.y) {
        score++;
        scoreEl.innerText = score;
        if (score > record) {
            record = score;
            recordEl.innerText = record;
        }
        placeFood();
    } else {
        snake.pop();
    }
    
    draw();
}

function handleGameOver() {
    finalScoreEl.innerText = score;
    overlayEl.classList.remove('hidden');
    if (!isAIMode) {
        cancelAnimationFrame(gameLoopId);
    }
}

// Game Loop for Manual Mode
let lastTime = 0;
function gameLoop(timestamp) {
    if (isAIMode) return; // AI loop is driven by websockets
    
    if (timestamp - lastTime >= 1000 / SPEED) {
        playStep();
        lastTime = timestamp;
    }
    if (!gameOver) {
        gameLoopId = requestAnimationFrame(gameLoop);
    }
}

// Input Handling
window.addEventListener('keydown', e => {
    if (isAIMode) return;
    switch(e.key) {
        case 'ArrowUp': if (direction !== Direction.DOWN) direction = Direction.UP; break;
        case 'ArrowDown': if (direction !== Direction.UP) direction = Direction.DOWN; break;
        case 'ArrowLeft': if (direction !== Direction.RIGHT) direction = Direction.LEFT; break;
        case 'ArrowRight': if (direction !== Direction.LEFT) direction = Direction.RIGHT; break;
    }
});

restartBtn.addEventListener('click', () => {
    initGame();
    if (!isAIMode) {
        gameLoopId = requestAnimationFrame(gameLoop);
    } else if (socket && socket.readyState === WebSocket.OPEN) {
        sendStateToAI();
    }
});

// AI Mode Logic
function connectAI() {
    socket = new WebSocket('ws://localhost:8000/ws');
    
    socket.onopen = () => {
        statusDot.className = 'status-dot connected';
        statusText.innerText = 'AI Server Connected';
        SPEED = 40; // faster for AI
        if (!gameOver) sendStateToAI();
    };

    socket.onmessage = (event) => {
        if (!isAIMode) return;
        const data = JSON.parse(event.data);
        
        // update stats
        document.getElementById('games').innerText = data.games;
        document.getElementById('epsilon').innerText = data.epsilon;
        
        // process action [straight, right, left]
        applyAIAction(data.action);
        
        playStep();
        
        if (!gameOver) {
            setTimeout(sendStateToAI, 1000/SPEED);
        } else {
            // AI auto-restart
            setTimeout(() => {
                initGame();
                sendStateToAI();
            }, 100); // quick restart
        }
    };

    socket.onclose = () => {
        statusDot.className = 'status-dot disconnected';
        statusText.innerText = 'AI Server Disconnected';
    };
}

function sendStateToAI() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    
    const state = {
        snake: snake,
        food: food,
        direction: direction,
        width: WIDTH,
        height: HEIGHT,
        block_size: BLOCK_SIZE
    };
    socket.send(JSON.stringify(state));
}

function applyAIAction(action) {
    // action is [straight, right, left]
    const clock_wise = [Direction.RIGHT, Direction.DOWN, Direction.LEFT, Direction.UP];
    let idx = clock_wise.indexOf(direction);
    
    if (action[1] === 1) { // right turn
        direction = clock_wise[(idx + 1) % 4];
    } else if (action[2] === 1) { // left turn
        direction = clock_wise[(idx + 3) % 4];
    }
    // straight means no change
}

modeManualBtn.addEventListener('click', () => {
    isAIMode = false;
    modeManualBtn.classList.add('active');
    modeAIBtn.classList.remove('active');
    statsGrid.classList.remove('ai-mode-active');
    SPEED = 15;
    if (socket) socket.close();
    initGame();
    gameLoopId = requestAnimationFrame(gameLoop);
});

modeAIBtn.addEventListener('click', () => {
    isAIMode = true;
    modeAIBtn.classList.add('active');
    modeManualBtn.classList.remove('active');
    statsGrid.classList.add('ai-mode-active');
    cancelAnimationFrame(gameLoopId);
    initGame();
    connectAI();
});

// Start manually
initGame();
gameLoopId = requestAnimationFrame(gameLoop);
