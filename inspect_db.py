import psycopg2
import psycopg2.extras
import os

# --- Supabase Database Configuration ---
DB_URI = os.environ.get(
    "DATABASE_URL", 
    "postgresql://postgres.damddtgyhrteskphtwab:QcC8mYZDOODQ5PkA@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require"
)

def inspect():
    try:
        conn = psycopg2.connect(DB_URI)
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    except Exception as e:
        print(f"Failed to connect to Supabase: {e}")
        print("Please check your internet connection or connection string credentials.")
        return

    print("\n" + "="*60)
    print("        LEETCODE TRACKER SUPABASE CLOUD INSPECTION")
    print("="*60)

    # 1. Inspect Users Table
    print("\n👤 REGISTERED CLOUD USERS:")
    print("-" * 60)
    print(f"{'ID':<5} | {'Username':<15} | {'Phone Number':<15} | {'Questions Solved':<10}")
    print("-" * 60)
    
    try:
        cursor.execute("SELECT id, username, phone FROM users ORDER BY id ASC")
        users = cursor.fetchall()
        
        if not users:
            print("No users registered on Supabase yet.")
        else:
            for user in users:
                user_id = user["id"]
                # Count solved questions
                cursor.execute("SELECT COUNT(*) as solved_count FROM progress WHERE user_id = %s", (user_id,))
                solved_count = cursor.fetchone()["solved_count"]
                print(f"{user_id:<5} | {user['username']:<15} | {user['phone']:<15} | {solved_count:<10}")
    except Exception as e:
        print(f"Error querying users: {e}")
        
    # 2. Inspect Active Sessions
    print("\n🔑 ACTIVE CLOUD SESSIONS:")
    print("-" * 60)
    print(f"{'User ID':<8} | {'Username':<15} | {'Session Token (Prefix)':<25} | {'Expires At':<20}")
    print("-" * 60)
    
    try:
        cursor.execute("""
            SELECT s.user_id, u.username, s.token, s.expires_at 
            FROM sessions s 
            JOIN users u ON s.user_id = u.id
            ORDER BY s.expires_at DESC
        """)
        sessions = cursor.fetchall()
        if not sessions:
            print("No active cloud sessions.")
        else:
            for session in sessions:
                token_prefix = session["token"][:12] + "..."
                expires_str = str(session["expires_at"])[:19]
                print(f"{session['user_id']:<8} | {session['username']:<15} | {token_prefix:<25} | {expires_str:<20}")
    except Exception as e:
        print(f"Error querying sessions: {e}")

    # 3. Overall Stats
    print("\n📊 OVERALL CLOUD STATISTICS:")
    print("-" * 60)
    try:
        cursor.execute("SELECT COUNT(*) as total_users FROM users")
        total_users = cursor.fetchone()["total_users"]
        cursor.execute("SELECT COUNT(*) as total_progress FROM progress")
        total_progress_records = cursor.fetchone()["total_progress"]
        cursor.execute("SELECT COUNT(DISTINCT question_link) as unique_solved FROM progress")
        unique_solved = cursor.fetchone()["unique_solved"]
        
        print(f"Total Registered Users:   {total_users}")
        print(f"Total Solved Checkmarks:  {total_progress_records}")
        print(f"Unique Questions Solved:  {unique_solved}")
    except Exception as e:
        print(f"Error querying stats: {e}")
        
    print("="*60 + "\n")
    cursor.close()
    conn.close()

if __name__ == "__main__":
    inspect()
