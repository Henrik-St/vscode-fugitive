Create and run the test container like the following:
```
docker build -t ubuntu-ssh .
docker run -d -p 2222:22 --name ssh-container ubuntu-ssh
```
Type in vscode: ssh docker@localhost -p 2222
Password docker