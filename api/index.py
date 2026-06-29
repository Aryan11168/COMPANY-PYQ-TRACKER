from flask import Flask, jsonify, request
from flask_cors import CORS
import psycopg2
import psycopg2.extras
import os
import hashlib
import uuid
from datetime import datetime, timedelta

app = Flask(__name__)
# Enable CORS for all routes (critical for Vercel routing)
CORS(app)

# Fallback string is hardcoded but Vercel dashboard environment variable 'DATABASE_URL' is preferred
DB_URI = os.environ.get(
    "DATABASE_URL", 
    "postgresql://postgres.damddtgyhrteskphtwab:QcC8mYZDOODQ5PkA@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require"
)

# Helper to connect to PostgreSQL
def get_db():
    return psycopg2.connect(DB_URI)

# Helper to hash passwords
def hash_password(password, salt):
    return hashlib.sha256((password + salt).encode("utf-8")).hexdigest()

# Helper to get authenticated user from headers
def get_authenticated_user(headers):
    auth_header = headers.get("Authorization")
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
    except Exception:
        return None
    finally:
        cursor.close()
        conn.close()

# Auto-initialize database tables in Postgres
def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(255) NOT NULL,
        phone VARCHAR(255) NOT NULL
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        token VARCHAR(255) PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL
    )
    """)
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

# Trigger DB check before handling requests
@app.before_request
def setup():
    global db_initialized
    if 'db_initialized' not in globals():
        try:
            init_db()
            db_initialized = True
        except Exception as e:
            print(f"Failed to auto-init tables: {e}")

# --- API Route Mapping ---

@app.route('/api/progress', methods=['GET'])
def get_progress():
    user_id = get_authenticated_user(request.headers)
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
        
    conn = get_db()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cursor.execute("SELECT question_link FROM progress WHERE user_id = %s", (user_id,))
        rows = cursor.fetchall()
        solved_links = [row["question_link"] for row in rows]
        return jsonify({"solved": solved_links})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/auth/signup', methods=['POST'])
def signup():
    data = request.json or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    phone = data.get("phone", "").strip()

    if not username or not password or not phone:
        return jsonify({"error": "All fields are required"}), 400

    conn = get_db()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
        if cursor.fetchone():
            return jsonify({"error": "Username already exists"}), 400

        salt = uuid.uuid4().hex
        pwd_hash = hash_password(password, salt)
        
        cursor.execute(
            "INSERT INTO users (username, password_hash, salt, phone) VALUES (%s, %s, %s, %s) RETURNING id",
            (username, pwd_hash, salt, phone)
        )
        user_id = cursor.fetchone()["id"]
        
        token = uuid.uuid4().hex
        expires_at = datetime.now() + timedelta(days=30)
        cursor.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)",
            (token, user_id, expires_at)
        )
        conn.commit()
        return jsonify({"token": token, "username": username}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    conn = get_db()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cursor.execute("SELECT id, password_hash, salt FROM users WHERE username = %s", (username,))
        row = cursor.fetchone()
        
        if not row:
            return jsonify({"error": "Invalid username or password"}), 400

        user_id = row["id"]
        db_hash = row["password_hash"]
        salt = row["salt"]
        
        if hash_password(password, salt) != db_hash:
            return jsonify({"error": "Invalid username or password"}), 400
        
        token = uuid.uuid4().hex
        expires_at = datetime.now() + timedelta(days=30)
        cursor.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)",
            (token, user_id, expires_at)
        )
        conn.commit()
        return jsonify({"token": token, "username": username}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/auth/reset', methods=['POST'])
def reset():
    data = request.json or {}
    username = data.get("username", "").strip()
    phone = data.get("phone", "").strip()
    new_password = data.get("new_password", "")

    if not username or not phone or not new_password:
        return jsonify({"error": "All fields are required"}), 400

    conn = get_db()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cursor.execute("SELECT id FROM users WHERE username = %s AND phone = %s", (username, phone))
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": "Incorrect username or registered phone number"}), 400

        user_id = row["id"]
        new_salt = uuid.uuid4().hex
        new_hash = hash_password(new_password, new_salt)
        
        cursor.execute(
            "UPDATE users SET password_hash = %s, salt = %s WHERE id = %s",
            (new_hash, new_salt, user_id)
        )
        cursor.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
        conn.commit()
        return jsonify({"message": "Password reset successful. Please login."}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        conn = get_db()
        cursor = conn.cursor()
        try:
            cursor.execute("DELETE FROM sessions WHERE token = %s", (token,))
            conn.commit()
        except Exception:
            pass
        finally:
            cursor.close()
            conn.close()
    return jsonify({"success": True}), 200

@app.route('/api/progress/toggle', methods=['POST'])
def toggle_progress():
    user_id = get_authenticated_user(request.headers)
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    link = data.get("link", "").strip()
    solved = data.get("solved", False)

    if not link:
        return jsonify({"error": "Question link is required"}), 400

    conn = get_db()
    cursor = conn.cursor()
    try:
        if solved:
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
        return jsonify({"success": True}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/progress/reset', methods=['POST'])
def reset_progress():
    user_id = get_authenticated_user(request.headers)
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM progress WHERE user_id = %s", (user_id,))
        conn.commit()
        return jsonify({"success": True}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

# Entry point for Vercel
if __name__ == '__main__':
    app.run(port=8000)
