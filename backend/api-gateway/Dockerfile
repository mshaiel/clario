# 1. Base Image
FROM python:3.10-slim

# 2. Set Working Directory
WORKDIR /code

# 3. Copy and Install Requirements
COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

# 4. Hugging Face Space User Setup (Crucial for permissions)
RUN useradd -m -u 1000 user
RUN chown -R user:user /code
RUN chmod 755 /code

USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

# 5. Copy App Code
COPY --chown=user . /code

# 6. Expose HF Space Port
EXPOSE 7860

# 7. Start Uvicorn Server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]