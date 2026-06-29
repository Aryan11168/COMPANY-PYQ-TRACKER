import http.server
import socketserver
import os
import json
import psycopg2
import psycopg2.extras
import hashlib
import uuid
from datetime import datetime, timedelta, timezone

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# --- Supabase Database Configuration ---
DB_URI = os.environ.get(
    "DATABASE_URL", 
    "postgresql://postgres.damddtgyhrteskphtwab:QcC8mYZDOODQ5PkA@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require"
)

# --- Database Initialization ---
def init_db():
    conn = psycopg2.connect(DB_URI)
    cursor = conn.cursor()
    
    # Create Users Table (using SERIAL for auto-increment in Postgres)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(255) NOT NULL,
        phone VARCHAR(255) NOT NULL
    )
    """)
    
    # Create Sessions Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        token VARCHAR(255) PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL
    )
    """)
    
    # Create Progress Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        question_link TEXT NOT NULL,
        PRIMARY KEY(user_id, question_link)
    )
    """)
    
    conn.commit()
    cursor.close()
    conn.close()

def get_db():
    conn = psycopg2.connect(DB_URI)
    return conn

# --- Security Helpers ---
def hash_password(password, salt):
    return hashlib.sha256((password + salt).encode("utf-8")).hexdigest()

# --- HTTP Request Handler ---
class TrackerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Enable CORS and disable cache for development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    # Get user_id from Authorization: Bearer <token>
    def get_authenticated_user(self):
        auth_header = self.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return None
        token = auth_header.split(" ")[1]
        
        conn = get_db()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            cursor.execute(
                "SELECT user_id FROM sessions WHERE token = %s AND expires_at > NOW()", 
                (token,)
            )
            row = cursor.fetchone()
            return row["user_id"] if row else None
        except Exception as e:
            print(f"Auth error: {e}")
            return None
        finally:
            cursor.close()
            conn.close()

    # Helper to send JSON responses
    def send_json(self, status, data):
        try:
            response_bytes = json.dumps(data).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response_bytes)))
            self.end_headers()
            self.wfile.write(response_bytes)
        except Exception as e:
            print(f"Error sending JSON response: {e}")

    # Process GET requests
    def do_GET(self):
        if self.path == "/api/progress":
            user_id = self.get_authenticated_user()
            if not user_id:
                self.send_json(401, {"error": "Unauthorized"})
                return
            
            conn = get_db()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            try:
                cursor.execute("SELECT question_link FROM progress WHERE user_id = %s", (user_id,))
                rows = cursor.fetchall()
                solved_links = [row["question_link"] for row in rows]
                self.send_json(200, {"solved": solved_links})
            except Exception as e:
                self.send_json(500, {"error": f"Database error: {str(e)}"})
            finally:
                cursor.close()
                conn.close()
            return
            
        # Fallback to serving static files
        super().do_GET()

    # Process POST requests
    def do_POST(self):
        # 1. Sign Up
        if self.path == "/api/auth/signup":
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
                username = data.get("username", "").strip()
                password = data.get("password", "")
                phone = data.get("phone", "").strip()
            except Exception:
                self.send_json(400, {"error": "Invalid JSON body"})
                return

            if not username or not password or not phone:
                self.send_json(400, {"error": "All fields are required"})
                return

            conn = get_db()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            try:
                # Check username uniqueness
                cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
                if cursor.fetchone():
                    self.send_json(400, {"error": "Username already exists"})
                    return

                # Hash Password
                salt = uuid.uuid4().hex
                pwd_hash = hash_password(password, salt)
                
                # Insert User (Postgres uses RETURNING id to get the auto-generated id)
                cursor.execute(
                    "INSERT INTO users (username, password_hash, salt, phone) VALUES (%s, %s, %s, %s) RETURNING id",
                    (username, pwd_hash, salt, phone)
                )
                user_id = cursor.fetchone()["id"]
                
                # Generate Session Token
                token = uuid.uuid4().hex
                expires_at = datetime.now(timezone.utc) + timedelta(days=30)
                cursor.execute(
                    "INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)",
                    (token, user_id, expires_at)
                )
                
                conn.commit()
                self.send_json(201, {"token": token, "username": username})
            except Exception as e:
                self.send_json(500, {"error": f"Database error: {str(e)}"})
            finally:
                cursor.close()
                conn.close()
            return

        # 2. Login
        elif self.path == "/api/auth/login":
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
                username = data.get("username", "").strip()
                password = data.get("password", "")
            except Exception:
                self.send_json(400, {"error": "Invalid JSON body"})
                return

            if not username or not password:
                self.send_json(400, {"error": "Username and password are required"})
                return

            conn = get_db()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            try:
                cursor.execute("SELECT id, password_hash, salt FROM users WHERE username = %s", (username,))
                row = cursor.fetchone()
                
                if not row:
                    self.send_json(400, {"error": "Invalid username or password"})
                    return

                user_id = row["id"]
                db_hash = row["password_hash"]
                salt = row["salt"]
                
                # Verify Password
                if hash_password(password, salt) != db_hash:
                    self.send_json(400, {"error": "Invalid username or password"})
                    return
                
                # Generate Session
                token = uuid.uuid4().hex
                expires_at = datetime.now(timezone.utc) + timedelta(days=30)
                
                cursor.execute(
                    "INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)",
                    (token, user_id, expires_at)
                )
                conn.commit()
                self.send_json(200, {"token": token, "username": username})
            except Exception as e:
                self.send_json(500, {"error": f"Database error: {str(e)}"})
            finally:
                cursor.close()
                conn.close()
            return

        # 3. Password Reset
        elif self.path == "/api/auth/reset":
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
                username = data.get("username", "").strip()
                phone = data.get("phone", "").strip()
                new_password = data.get("new_password", "")
            except Exception:
                self.send_json(400, {"error": "Invalid JSON body"})
                return

            if not username or not phone or not new_password:
                self.send_json(400, {"error": "All fields are required"})
                return

            conn = get_db()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            try:
                cursor.execute("SELECT id FROM users WHERE username = %s AND phone = %s", (username, phone))
                row = cursor.fetchone()
                
                if not row:
                    self.send_json(400, {"error": "Incorrect username or registered phone number"})
                    return

                user_id = row["id"]
                
                # Hash New Password
                new_salt = uuid.uuid4().hex
                new_hash = hash_password(new_password, new_salt)
                
                # Update Credentials
                cursor.execute(
                    "UPDATE users SET password_hash = %s, salt = %s WHERE id = %s",
                    (new_hash, new_salt, user_id)
                )
                cursor.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
                
                conn.commit()
                self.send_json(200, {"message": "Password reset successful. Please login."})
            except Exception as e:
                self.send_json(500, {"error": f"Database error: {str(e)}"})
            finally:
                cursor.close()
                conn.close()
            return

        # 4. Log Out
        elif self.path == "/api/auth/logout":
            auth_header = self.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header.split(" ")[1]
                conn = get_db()
                cursor = conn.cursor()
                try:
                    cursor.execute("DELETE FROM sessions WHERE token = %s", (token,))
                    conn.commit()
                except Exception as e:
                    print(f"Logout db error: {e}")
                finally:
                    cursor.close()
                    conn.close()
            self.send_json(200, {"success": True})
            return

        # 5. Toggle Question Progress
        elif self.path == "/api/progress/toggle":
            user_id = self.get_authenticated_user()
            if not user_id:
                self.send_json(401, {"error": "Unauthorized"})
                return

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
                link = data.get("link", "").strip()
                solved = data.get("solved", False)
            except Exception:
                self.send_json(400, {"error": "Invalid JSON body"})
                return

            if not link:
                self.send_json(400, {"error": "Question link is required"})
                return

            conn = get_db()
            cursor = conn.cursor()
            try:
                if solved:
                    # Postgres conflict clause equivalent to SQLite INSERT OR IGNORE
                    cursor.execute(
                        "INSERT INTO progress (user_id, question_link) VALUES (%s, %s) ON CONFLICT (user_id, question_link) DO NOTHING",
                        (user_id, link)
                    )
                else:
                    cursor.execute(
                        "DELETE FROM progress WHERE user_id = %s AND question_link = %s",
                        (user_id, link)
                    )
                conn.commit()
                self.send_json(200, {"success": True})
            except Exception as e:
                self.send_json(500, {"error": f"Database error: {str(e)}"})
            finally:
                cursor.close()
                conn.close()
            return

        # 6. Reset Question Progress
        elif self.path == "/api/progress/reset":
            user_id = self.get_authenticated_user()
            if not user_id:
                self.send_json(401, {"error": "Unauthorized"})
                return

            conn = get_db()
            cursor = conn.cursor()
            try:
                cursor.execute("DELETE FROM progress WHERE user_id = %s", (user_id,))
                conn.commit()
                self.send_json(200, {"success": True})
            except Exception as e:
                self.send_json(500, {"error": f"Database error: {str(e)}"})
            finally:
                cursor.close()
                conn.close()
            return

        # Unsupported endpoints
        self.send_json(404, {"error": "API route not found"})

# --- Main Entry ---
if __name__ == "__main__":
    init_db()
    
    try:
        from http.server import ThreadingHTTPServer as HTTPServer
    except ImportError:
        from http.server import HTTPServer
        
    socketserver.TCPServer.allow_reuse_address = True
    
    with HTTPServer(("", PORT), TrackerHandler) as httpd:
        print(f"Serving Supabase-Backed LeetCode Tracker at http://localhost:{PORT}")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping server.")
