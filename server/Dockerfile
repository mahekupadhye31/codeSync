FROM node:20-alpine

# Toolchains for the local code runner (server/src/execution/local.js):
#   python3 -> Python, g++ -> C++, openjdk21 -> Java, go -> Go.
# node (JavaScript) is already present in the base image.
RUN apk add --no-cache python3 g++ make git bash openjdk21 go
# Put javac/java on PATH and give Go a writable build cache.
ENV PATH="/usr/lib/jvm/default-jvm/bin:${PATH}"
ENV GOCACHE=/tmp/.gocache

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001

CMD ["npm", "run", "dev"]
