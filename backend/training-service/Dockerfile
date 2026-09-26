# 1. Base Image: Python 3.9 Slim (Small & Fast)
FROM python:3.9-slim

# 2. Set Working Directory inside container
WORKDIR /code

# 3. Copy Requirements first (optimizes build cache)
COPY ./requirements.txt /code/requirements.txt

# 4. Install Dependencies
# --no-cache-dir keeps the image small
# The --index-url in requirements.txt ensures we get the CPU version of Torch
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

# 5. Set up the "user" (Hugging Face Security Requirement)
# Spaces requires the app to run as user ID 1000, not root.
RUN useradd -m -u 1000 user

# Switch to non-root user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

# 6. Copy the rest of the application code
# --chown=user ensures the non-root user owns the files
COPY --chown=user . /code

# 7. Expose the standard Spaces port
EXPOSE 7860

# 8. Start the API
# main:app points to 'main.py' file and 'app' FastAPI object
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]