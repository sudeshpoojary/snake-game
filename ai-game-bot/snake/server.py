from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from agent import Agent
from game import Direction, Point
import json
import torch
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

agent = Agent()

# Try to load existing trained model
if os.path.exists('./model/model.pth'):
    try:
        agent.model.load_state_dict(torch.load('./model/model.pth'))
        agent.model.eval()
        agent.n_games = 100 # trick it into exploitation mode
        print("Loaded trained model successfully.")
    except Exception as e:
        print("Error loading model:", e)

class MockGame:
    def __init__(self, data):
        self.w = data['width']
        self.h = data['height']
        self.head = Point(data['snake'][0]['x'], data['snake'][0]['y'])
        self.snake = [Point(pt['x'], pt['y']) for pt in data['snake']]
        if data['food']:
            self.food = Point(data['food']['x'], data['food']['y'])
        else:
            self.food = Point(0, 0)
        
        dir_val = data['direction']
        if dir_val == 1: self.direction = Direction.RIGHT
        elif dir_val == 2: self.direction = Direction.LEFT
        elif dir_val == 3: self.direction = Direction.UP
        elif dir_val == 4: self.direction = Direction.DOWN

    def is_collision(self, pt=None):
        if pt is None:
            pt = self.head
        # boundary
        if pt.x >= self.w or pt.x < 0 or pt.y >= self.h or pt.y < 0:
            return True
        # self
        if pt in self.snake[1:]:
            return True
        return False

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            state_data = json.loads(data)
            
            mock_game = MockGame(state_data)
            state = agent.get_state(mock_game)
            
            # Ensure epsilon doesn't go negative
            agent.epsilon = max(0, 80 - agent.n_games)
            final_move = agent.get_action(state)
            
            response = {
                "action": final_move,
                "games": agent.n_games,
                "epsilon": agent.epsilon
            }
            
            await websocket.send_text(json.dumps(response))
    except WebSocketDisconnect:
        pass
