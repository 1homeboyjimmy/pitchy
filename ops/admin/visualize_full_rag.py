import os
import argparse
import pandas as pd
import numpy as np
import chromadb
from sklearn.manifold import TSNE
from sklearn.decomposition import PCA
import plotly.express as px
import logging

# Setup logging
# We don't call basicConfig here to avoid clobbering main app's logging setup
logger = logging.getLogger("RAG-Viz")
logger.setLevel(logging.INFO)

# Default paths
DEFAULT_ADMIN_DOCS = "admin_docs"
CHROMA_PATH = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")
DEFAULT_OUTPUT = os.path.join(DEFAULT_ADMIN_DOCS, "rag_visualization.html")

def fetch_data(client, collection_names):
    """Fetches documents, embeddings, and metadata from specified collections."""
    all_data = []
    
    for name in collection_names:
        try:
            logger.info(f"Fetching data from collection: {name}")
            collection = client.get_collection(name)
            data = collection.get(include=['documents', 'embeddings', 'metadatas'])
            
            if data.get('embeddings') is None or len(data['embeddings']) == 0:
                logger.warning(f"Collection '{name}' has no embeddings. Skipping.")
                continue
                
            count = len(data['ids'])
            for i in range(count):
                all_data.append({
                    "id": data['ids'][i],
                    "document": data['documents'][i][:500] + "..." if len(data['documents'][i]) > 500 else data['documents'][i],
                    "embedding": data['embeddings'][i],
                    "metadata": str(data['metadatas'][i]) if data['metadatas'][i] else "{}",
                    "collection": name
                })
            logger.info(f"Successfully fetched {count} points from '{name}'.")
        except Exception as e:
            logger.error(f"Error fetching from '{name}': {e}")
            
    return all_data

# Ensure status file is in admin_docs for persistence/access
STATUS_FILE = os.path.abspath(os.path.join(DEFAULT_ADMIN_DOCS, "rag_viz.lock"))

def set_status(busy: bool):
    if busy:
        with open(STATUS_FILE, "w") as f:
            f.write("processing")
    else:
        if os.path.exists(STATUS_FILE):
            os.remove(STATUS_FILE)

def visualize_rag(collection_name=None, dims=3, output_file=None, method='tsne'):
    """Main visualization logic."""
    if output_file is None:
        output_file = DEFAULT_OUTPUT

    # Ensure target directory exists
    os.makedirs(os.path.dirname(os.path.abspath(output_file)), exist_ok=True)

    set_status(True)
    try:
        # Versioning: backup previous file
        if os.path.exists(output_file):
            backup_file = output_file + ".bak"
            import shutil
            shutil.copy2(output_file, backup_file)
            logger.info(f"Existing visualization backed up to {backup_file}")

        # 1. Connect to ChromaDB
        http_host = os.getenv("CHROMA_HTTP_HOST")
        http_port = os.getenv("CHROMA_HTTP_PORT", "8000")

        if http_host:
            logger.info(f"Connecting to ChromaDB via HTTP at {http_host}:{http_port}")
            client = chromadb.HttpClient(host=http_host, port=int(http_port))
        else:
            logger.info(f"Connecting to ChromaDB via PersistentClient at: {CHROMA_PATH}")
            client = chromadb.PersistentClient(path=CHROMA_PATH)
        
        # 2. Identify collections
        all_collections = [c.name for c in client.list_collections()]
        if not all_collections:
            logger.error("No collections found in ChromaDB.")
            return
            
        if collection_name and collection_name.lower() != 'all':
            if collection_name not in all_collections:
                logger.error(f"Collection '{collection_name}' not found. Available: {all_collections}")
                return
            target_collections = [collection_name]
        else:
            target_collections = all_collections
            logger.info(f"Visualizing all {len(target_collections)} collections.")

        # 3. Fetch data
        data_points = fetch_data(client, target_collections)
        if not data_points:
            logger.error("No data extracted for visualization.")
            return
            
        df = pd.DataFrame(data_points)
        embeddings = np.array(df['embedding'].tolist())
        
        # 4. Dimensionality Reduction
        if len(embeddings) < 5:
            logger.warning(f"Collection has only {len(embeddings)} points. Too few for reliable t-SNE. Skipping Plotting details.")
            fig = px.scatter(title=f"Collection '{target_collections[0]}' has too few points (<5) for 3D visualization")
            fig.write_html(output_file)
            return

        logger.info(f"Reducing dimensions to {dims}D using {method.upper()}...")
        if method.lower() == 'pca':
            reducer = PCA(n_components=dims)
        else:
            # t-SNE is generally better for clusters
            perplexity = min(30, len(embeddings) - 1)
            reducer = TSNE(n_components=dims, random_state=42, perplexity=perplexity)
            
        projections = reducer.fit_transform(embeddings)
        
        for i in range(dims):
            df[f'dim_{i+1}'] = projections[:, i]
            
        # 5. Create Plotly Figure
        logger.info("Generating Plotly dashboard...")
        hover_data = ["id", "collection", "document"]
        
        if dims == 3:
            fig = px.scatter_3d(
                df, x='dim_1', y='dim_2', z='dim_3',
                color='collection',
                hover_data=hover_data,
                title=f"RAG Semantic Map ({method.upper()} 3D-Projection)",
                template="plotly_dark"
            )
        else:
            fig = px.scatter(
                df, x='dim_1', y='dim_2',
                color='collection',
                hover_data=hover_data,
                title=f"RAG Semantic Map ({method.upper()} 2D-Projection)",
                template="plotly_dark"
            )
            
        fig.update_traces(marker=dict(size=5, opacity=0.7))
        
        # Force hover data to include coordinates and IDs
        fig.update_traces(
            hovertemplate="<br>".join([
                "<b>ID: %{customdata[0]}</b>",
                "Collection: %{customdata[1]}",
                "X: %{x}",
                "Y: %{y}",
                "Z: %{z}" if dims == 3 else "",
                "<br>Text: %{customdata[2]}"
            ])
        )
        
        fig.write_html(output_file)
        logger.info(f"DONE! Visualization saved to: {output_file}")
        print(f"\n[SUCCESS] Visualization complete.")
        print(f"File: {os.path.abspath(output_file)}")
    finally:
        set_status(False)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ChromaDB RAG Visualizer (Plotly + t-SNE)")
    parser.add_argument("--collection", type=str, default=None, help="Collection name to visualize (or 'all')")
    parser.add_argument("--dims", type=int, choices=[2, 3], default=3, help="Dimensions for visualization (2 or 3)")
    parser.add_argument("--method", type=str, choices=['tsne', 'pca'], default='tsne', help="Reduction method")
    parser.add_argument("--output", type=str, default=None, help="Output HTML file name")
    
    args = parser.parse_args()
    
    # Interactive mode if no collection specified
    if args.collection is None:
        client = chromadb.PersistentClient(path=CHROMA_PATH)
        cols = [c.name for c in client.list_collections()]
        if not cols:
            print("No collections found.")
        else:
            print("\nAvailable RAG Collections:")
            for idx, name in enumerate(cols):
                print(f"[{idx}] {name}")
            print(f"[{len(cols)}] ALL COLLECTIONS")
            
            try:
                raw_input = input("\nChoose collection index to visualize (or press Enter for ALL): ").strip()
                if raw_input == "":
                    args.collection = 'all'
                else:
                    choice = int(raw_input)
                    if choice == len(cols):
                        args.collection = 'all'
                    elif 0 <= choice < len(cols):
                        args.collection = cols[choice]
                    else:
                        print(f"Index {choice} is out of range.")
                        exit(1)
            except (ValueError, EOFError):
                print("\n[INFO] Interactive input not supported or invalid. Defaulting to '--collection all'.")
                print("[TIP] You can also use CLI flags: python ops/admin/visualize_full_rag.py --collection <name>")
                args.collection = 'all'
    
    visualize_rag(
        collection_name=args.collection,
        dims=args.dims,
        method=args.method,
        output_file=args.output
    )
