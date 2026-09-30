using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Porkour
{
    /// <summary>Helpers for code-made placeholder effects (until real VFX from asset packs).</summary>
    public static class FxUtil
    {
        public static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        static readonly Dictionary<PrimitiveType, Mesh> Meshes = new();

        /// <summary>Unity's built-in primitive mesh (sphere, cube...) without creating a collider object each time.</summary>
        public static Mesh PrimitiveMesh(PrimitiveType type)
        {
            if (Meshes.TryGetValue(type, out var mesh) && mesh != null) return mesh;
            var temp = GameObject.CreatePrimitive(type);
            mesh = temp.GetComponent<MeshFilter>().sharedMesh;
            Object.DestroyImmediate(temp);
            Meshes[type] = mesh;
            return mesh;
        }

        /// <summary>Renderer-only object (no collider) with a primitive mesh.</summary>
        public static MeshRenderer NewMeshObject(string name, PrimitiveType type, Transform parent, Material material)
        {
            var go = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            go.GetComponent<MeshFilter>().sharedMesh = PrimitiveMesh(type);
            go.transform.SetParent(parent, false);
            var r = go.GetComponent<MeshRenderer>();
            r.sharedMaterial = material;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.enabled = material != null;
            return r;
        }

        /// <summary>URP Lit material (opaque or see-through). Null if URP shaders are missing.</summary>
        public static Material NewMaterial(Color color, bool transparent)
        {
            var shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) shader = Shader.Find("Universal Render Pipeline/Unlit");
            if (shader == null) return null;

            var mat = new Material(shader);
            mat.SetFloat("_Smoothness", 0f);
            if (transparent)
            {
                mat.SetFloat("_Surface", 1f);
                mat.SetFloat("_Blend", 0f);
                mat.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
                mat.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                mat.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
                mat.SetFloat("_DstBlendAlpha", (float)BlendMode.OneMinusSrcAlpha);
                mat.SetFloat("_ZWrite", 0f);
                mat.SetFloat("_Cull", (float)CullMode.Off); // inside a cloud you see it
                mat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                mat.SetOverrideTag("RenderType", "Transparent");
                mat.renderQueue = (int)RenderQueue.Transparent;
            }
            mat.SetColor(BaseColorId, color);
            return mat;
        }
    }
}
