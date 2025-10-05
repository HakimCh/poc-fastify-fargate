#!/bin/bash

echo "Creating EventBridge bus..."
awslocal events create-event-bus --name local-event-bus

echo "EventBridge setup complete!"
