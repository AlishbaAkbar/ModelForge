import time

def run_training(dataset_id):
    print(f"Training started for dataset: {dataset_id}")

    for i in range(5):
        print(f"Step {i+1}/5")
        time.sleep(2)

    print("Training completed")