FROM node:20

WORKDIR /home/crypto-bot-surfer

RUN apt update && \
    apt install -y git

COPY . .

RUN npm install

CMD ["npm", "run", "nodemon"]